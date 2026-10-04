"""An in-memory stand-in for the ERP's integration API, served through httpx.MockTransport.

It behaves like the real one where the POS depends on it: bearer tokens that can expire,
paginated lists, the same money arithmetic, stock checks, payments that must add up, and
order import that is idempotent on external_id.
"""

import json
import re
import uuid

import httpx

from pos.services.common import line_amount, tax_amount


class FakeErp:
    def __init__(self):
        self.down = False
        self.features = ["paid_sales", "line_discounts", "customer_create", "cashier_login", "supervisors", "returns",
                         "promotions", "loyalty", "stock_requests"]
        self.loyalty = {"earn_per": 10_000, "point_value": 100}
        self.tokens: set[str] = set()
        self.tokens_issued = 0
        self.settings = {"company_name": "Kios Gawai", "company_address": "Jl. Sudirman 1", "company_phone": "021",
                         "company_tax_id": "01.234", "tax_rate": 11, "currency": "IDR"}
        self.warehouses = [self._row(code="JKT-DC", name="Jakarta DC", city="Jakarta"),
                           self._row(code="BDG-01", name="Bandung Store", city="Bandung")]
        self.products = [
            self._row(sku="PH-1", name="Phone One", barcode="8990001", unit="pcs", price=1_000_000, active=True,
                      category="Smartphones", brand="Acme"),
            self._row(sku="CB-1", name="USB-C Cable", barcode="8990002", unit="pcs", price=50_000, active=True,
                      category="Cables", brand="Acme"),
            self._row(sku="OLD-1", name="Discontinued", barcode=None, unit="pcs", price=10_000, active=False,
                      category=None, brand=None),
        ]
        self.customers = [self._row(code="C-0001", name="Budi Reseller", phone="0811", email="budi@example.com",
                                    group="Reseller", discount_pct=10, points=500)]
        self.promotions: list[dict] = []
        self.returns: dict[str, dict] = {}
        self.transfers: list[dict] = []
        # (warehouse id, product id) -> on hand
        self.stock = {(self.warehouses[1]["id"], self.products[0]["id"]): 5,
                      (self.warehouses[1]["id"], self.products[1]["id"]): 100}
        self.orders: dict[str, dict] = {}
        self.calls: list[str] = []
        self.while_importing = None  # called mid-import: lets a test act while the ERP is busy
        # username -> [password, full name, role, failed attempts]; only "cashier" may sell
        self.users = {"cashier": ["password123", "Putri Ayu", "cashier", 0],
                      "cashier2": ["password123", "Second Cashier", "cashier", 0],
                      "sales": ["password123", "Andi Sales", "sales", 0],
                      "manager": ["password123", "Dewi Manager", "manager", 0]}

    @staticmethod
    def _row(**values) -> dict:
        return {"id": str(uuid.uuid4()), **values}

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def expire_tokens(self) -> None:
        self.tokens.clear()

    # ------------------------------------------------------------ request handling

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        path = request.url.path.removeprefix("/api/integration/v1")
        self.calls.append(f"{request.method} {path}")
        if path == "/token":
            body = json.loads(request.content)
            if body.get("client_secret") != "s3cret":
                return httpx.Response(401, json={"detail": "invalid_client"})
            token = f"tok-{uuid.uuid4().hex}"
            self.tokens.add(token)
            self.tokens_issued += 1
            return httpx.Response(200, json={"access_token": token, "token_type": "bearer", "expires_in": 3600})
        if request.headers.get("authorization", "").removeprefix("Bearer ") not in self.tokens:
            return httpx.Response(401, json={"detail": "invalid or expired token"})

        if request.method == "POST" and path == "/cashiers/login":
            return self._cashier_login(json.loads(request.content))
        if request.method == "POST" and path == "/cashiers/password":
            body = json.loads(request.content)
            user = self.users.get(body["username"])
            if user is None or body["current_password"] != user[0]:
                return httpx.Response(401, json={"detail": "Wrong username or password."})
            if body["new_password"] == user[0]:
                return httpx.Response(422, json={"detail": "Pick a password different from the current one."})
            user[0] = body["new_password"]
            return httpx.Response(200, json={"username": body["username"], "full_name": user[1]})
        if request.method == "GET" and (m := re.fullmatch(r"/cashiers/([^/]+)", path)):
            user = self.users.get(m[1])
            if user is None or user[2] != "cashier":
                return httpx.Response(404, json={"detail": "cashier not found"})
            return httpx.Response(200, json={"username": m[1], "full_name": user[1], "email": f"{m[1]}@kios.test",
                                             "role": "Cashier", "active": True, "created_at": "2026-01-02T03:04:05",
                                             "last_login_at": None})
        if request.method == "POST" and path == "/supervisors/verify":
            return self._verify_supervisor(json.loads(request.content))
        if request.method == "GET" and path == "/settings":
            return httpx.Response(200, json={**self.settings, "features": self.features, "loyalty": self.loyalty})
        if request.method == "GET" and path in ("/warehouses", "/products", "/customers", "/promotions"):
            rows = {"/warehouses": self.warehouses, "/products": self.products, "/customers": self.customers,
                    "/promotions": self.promotions}[path]
            return self._page(request, rows)
        if m := re.fullmatch(r"/customers/([^/]+)", path):
            customer = next((c for c in self.customers if c["id"] == m[1]), None)
            return httpx.Response(200, json=customer) if customer else httpx.Response(404, json={"detail": "nope"})
        if request.method == "POST" and path == "/sales-returns":
            return self._return(json.loads(request.content))
        if request.method == "POST" and path == "/stock-requests":
            body = json.loads(request.content)
            self.transfers.append(body)
            return httpx.Response(201, json={"number": f"TR-2026-{len(self.transfers):05d}", "status": "draft",
                                             "from": "Jakarta DC", "to": "Bandung Store",
                                             "units": sum(li["qty"] for li in body["lines"])})
        if m := re.fullmatch(r"/warehouses/([^/]+)/stock", path):
            rows = [{"product_id": p, "on_hand": q} for (w, p), q in self.stock.items() if w == m[1]]
            return self._page(request, rows)
        if request.method == "POST" and path == "/customers":
            body = json.loads(request.content)
            row = self._row(code=f"C-{len(self.customers) + 1:04d}", name=body["name"].strip(),
                            phone=body.get("phone"), email=body.get("email"), group=None, discount_pct=0, points=0)
            self.customers.append(row)
            return httpx.Response(201, json=row)
        if request.method == "POST" and path == "/sales-orders":
            return self._import(json.loads(request.content))
        return httpx.Response(404, json={"detail": "Not Found"})

    def _cashier_login(self, body: dict) -> httpx.Response:
        user = self.users.get(body["username"].strip().lower())
        if user is None:
            return httpx.Response(401, json={"detail": "Wrong username or password."})
        if user[3] >= 5:
            return httpx.Response(423, json={"detail": "Too many failed attempts. Try again in 5 minute(s)."})
        if body["password"] != user[0]:
            user[3] += 1
            return httpx.Response(401, json={"detail": "Wrong username or password."})
        if user[2] != "cashier":
            return httpx.Response(403, json={"detail": "Only cashier accounts can use the POS."})
        user[3] = 0
        return httpx.Response(200, json={"username": body["username"].strip().lower(), "full_name": user[1],
                                         "email": None})

    def _verify_supervisor(self, body: dict) -> httpx.Response:
        user = self.users.get(body["username"].strip().lower())
        if user is None or body["password"] != user[0]:
            return httpx.Response(401, json={"detail": "Wrong username or password."})
        if user[2] != "manager":
            return httpx.Response(403, json={"detail": f"{user[1]} can't approve at the till. Ask a manager."})
        return httpx.Response(200, json={"username": body["username"].strip().lower(), "full_name": user[1]})

    def _return(self, body: dict) -> httpx.Response:
        if body["external_id"] in self.returns:
            return httpx.Response(200, json=self.returns[body["external_id"]])
        order = self.orders.get(body["order_external_id"])
        if order is None:
            return httpx.Response(404, json={"detail": "No such order."})
        total = sum(r["amount"] for r in body["refunds"])
        for li in body["lines"]:
            key = (order["body"]["warehouse_id"], li["product_id"])
            self.stock[key] = self.stock.get(key, 0) + li["qty"]
        customer = next(c for c in self.customers if c["id"] == order["body"]["customer_id"])
        customer["points"] += sum(r["amount"] for r in body["refunds"] if r["method"] == "points") // 100
        ret = {"number": f"SR-2026-{len(self.returns) + 1:05d}", "external_id": body["external_id"],
               "order_number": order["number"], "total": total, "points_reversed": 0,
               "points_balance": customer["points"], "body": body}
        self.returns[body["external_id"]] = ret
        return httpx.Response(201, json=ret)

    @staticmethod
    def _page(request: httpx.Request, rows: list[dict]) -> httpx.Response:
        page = int(request.url.params.get("page", 1))
        size = int(request.url.params.get("page_size", 25))
        items = rows[(page - 1) * size: page * size]
        return httpx.Response(200, json={"items": items, "total": len(rows), "page": page, "page_size": size})

    def _import(self, body: dict) -> httpx.Response:
        if self.while_importing:
            hook, self.while_importing = self.while_importing, None
            hook()
        if body["external_id"] in self.orders:
            return httpx.Response(200, json=self.orders[body["external_id"]])
        customer = next((c for c in self.customers if c["id"] == body["customer_id"]), None)
        products = {p["id"]: p for p in self.products}
        if customer is None or body["warehouse_id"] not in {w["id"] for w in self.warehouses}:
            return httpx.Response(422, json={"detail": "Unknown customer or warehouse."})
        subtotal = 0
        for li in body["lines"]:
            product = products.get(li["product_id"])
            if product is None:
                return httpx.Response(422, json={"detail": f"Unknown products: ['{li['product_id']}']"})
            discount = customer["discount_pct"] if li.get("discount_pct") is None else li["discount_pct"]
            price = product["price"] if li.get("unit_price") is None else li["unit_price"]
            subtotal += line_amount(li["qty"], price, discount)
        total = subtotal + tax_amount(subtotal, self.settings["tax_rate"])
        paid = sum(p["amount"] for p in body.get("payments") or [])
        if body.get("payments") is not None and paid != total:
            return httpx.Response(422, json={"detail": f"Payments add up to {paid}, the order total is {total}."})
        for li in body["lines"]:
            key = (body["warehouse_id"], li["product_id"])
            if self.stock.get(key, 0) < li["qty"]:
                return httpx.Response(409, json={"detail": f"Not enough {products[li['product_id']]['name']}: "
                                                           f"{self.stock.get(key, 0)} on hand, {li['qty']} needed."})
        by_points = sum(p["amount"] for p in body.get("payments") or [] if p["method"] == "points")
        if by_points // 100 > customer.get("points", 0):
            return httpx.Response(409, json={"detail": f"{customer['name']} has {customer.get('points', 0)} points."})
        for li in body["lines"]:
            self.stock[(body["warehouse_id"], li["product_id"])] -= li["qty"]
        earned = (total - by_points) // self.loyalty["earn_per"] if body.get("earn_points") else 0
        customer["points"] = customer.get("points", 0) - by_points // 100 + earned
        n = len(self.orders) + 1
        order = {"number": f"SO-2026-{n:05d}", "external_id": body["external_id"], "status": "delivered",
                 "total": total, "invoice_number": f"INV-2026-{n:05d}", "invoice_status": "paid", "body": body,
                 "points_earned": earned, "points_balance": customer["points"]}
        self.orders[body["external_id"]] = order
        return httpx.Response(201, json=order)

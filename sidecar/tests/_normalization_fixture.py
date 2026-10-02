import json
import re
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@contextmanager
def normalization_server():
    """Declared Ollama response fixture; no model or embedding qualification."""
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.path != "/api/generate":
                self.send_error(503)
                return
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(payload)
            source = re.search(r"--- RAW OCR TEXT FOR PAGE \d+ ---\n(.*?)\n--- END RAW OCR TEXT ---", payload["prompt"], re.DOTALL).group(1)
            model = payload["model"]
            output = "# " + source.replace("\n", " ")
            done = True
            reason = "stop"
            if model == "normalizer-truncated":
                reason = "length"
            elif model in ("normalizer-entities", "normalizer-last-page"):
                output = output.replace("AB123", "AB999")
            elif model == "normalizer-omission":
                output = output.replace("Payment is not due without a signature.", "")
            elif model == "normalizer-empty":
                output = ""
            elif model == "normalizer-incomplete":
                done = False
            body = json.dumps({"response": output, "done": done, "done_reason": reason}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

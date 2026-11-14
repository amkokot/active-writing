"""Offline helper regression tests: no GPU, model download or HTTP requests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from awDelegate import ask, exclusive, validate_request, validate_result

PACKET = {"version": 1, "task": "extract", "instruction": "Extract the explicit failure", "context": [{"id": "log", "text": "failed seed=7"}],
          "owner": {"project": "project", "entry": "entry", "notebook": "owner"}}
ANSWER = {"summary": "seed 7 failed", "findings": [{"source": "log", "detail": "seed=7"}], "checks": []}


class DelegateChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cfg = {"model": "qwen3:8b", "digest": "a" * 64, "endpoint": "http://127.0.0.1:11436", "state": str(self.root / "state")}
        self.calls = []

    def transport(self, endpoint, route, body=None, timeout=5):
        self.calls.append(route)
        if route == "/api/tags":
            return {"models": [{"name": self.cfg["model"], "digest": self.cfg["digest"]}]}
        if route == "/api/show":
            return {}
        self.assertEqual(route, "/api/chat")
        self.assertEqual(body["keep_alive"], 0)
        self.assertFalse(body["think"])
        self.assertNotIn("tools", body)
        self.assertEqual(timeout, 120)
        return {"done": True, "done_reason": "stop", "message": {"content": json.dumps(ANSWER)}, "eval_count": 12}

    def run_ask(self, **kwargs):
        return ask(self.cfg, copy.deepcopy(PACKET), self.root, transport=self.transport, gpu_check=lambda: {}, **kwargs)

    def test_cache_needs_no_gpu_or_runtime(self):
        result = self.run_ask()
        self.assertFalse(result["cached"])
        self.calls.clear()
        result2 = ask(self.cfg, PACKET, self.root, transport=lambda *a, **k: self.fail("network on cache hit"), gpu_check=lambda: self.fail("GPU on cache hit"))
        self.assertTrue(result2["cached"])
        self.assertEqual(result["key"], result2["key"])
        self.assertEqual(len(list(self.root.glob("local-assistance/*.attempt.json"))), 1)

    def test_owner_and_model_digest_change_cache(self):
        first = self.run_ask()
        packet = copy.deepcopy(PACKET)
        packet["owner"]["entry"] = "another"
        second = ask(self.cfg, packet, self.root, transport=self.transport, gpu_check=lambda: {})
        self.assertNotEqual(first["key"], second["key"])

    def test_busy_and_gpu_stop_without_model(self):
        self.cfg["state"] = str(self.root)
        with exclusive(self.root / "request.lock"):
            with self.assertRaisesRegex(ValueError, "busy"):
                self.run_ask()
        with self.assertRaisesRegex(ValueError, "occupied"):
            ask(self.cfg, PACKET, self.root, transport=self.transport, gpu_check=lambda: (_ for _ in ()).throw(ValueError("GPU occupied")))
        self.assertEqual(self.calls, [])

    def test_incomplete_retains_attempt_not_cache(self):
        def incomplete(endpoint, route, body=None, timeout=5):
            result = self.transport(endpoint, route, body, timeout)
            if route == "/api/chat":
                result["done_reason"] = "length"
            return result
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            ask(self.cfg, PACKET, self.root, transport=incomplete, gpu_check=lambda: {})
        self.assertEqual(len(list(self.root.glob("local-assistance/*.json"))), 1)
        self.assertFalse((Path(self.cfg["state"]) / "request.lock").exists())

    def test_cloud_alias_and_changed_digest_rejected(self):
        def cloud(endpoint, route, body=None, timeout=5):
            if route == "/api/show":
                return {"remote_host": "cloud"}
            return self.transport(endpoint, route, body, timeout)
        with self.assertRaisesRegex(ValueError, "Cloud"):
            ask(self.cfg, PACKET, self.root, transport=cloud, gpu_check=lambda: {})
        self.assertNotIn("/api/chat", self.calls)

    def test_no_fabricated_source_or_unbounded_context(self):
        result = copy.deepcopy(ANSWER)
        result["findings"][0]["source"] = "invented"
        with self.assertRaises(ValueError):
            validate_result(result, {"log"})
        packet = copy.deepcopy(PACKET)
        packet["context"][0]["text"] = "x" * 14001
        with self.assertRaises(ValueError):
            validate_request(packet)
        packet = copy.deepcopy(PACKET)
        packet["task"] = "shell-execution"
        with self.assertRaises(ValueError):
            validate_request(packet)

    def test_cap_and_tampered_cache(self):
        self.run_ask()
        state = Path(self.cfg["state"]) / "daily.json"
        data = json.loads(state.read_text())
        data["attempts"] = 100
        state.write_text(json.dumps(data))
        self.calls.clear()
        with self.assertRaisesRegex(ValueError, "cap"):
            self.run_ask(fresh=True)
        self.assertEqual(self.calls, [])
        cache = next(p for p in self.root.glob("local-assistance/*.json") if not p.name.endswith("attempt.json"))
        data = json.loads(cache.read_text())
        data["key"] = "altered"
        cache.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "Changed cached"):
            self.run_ask()


if __name__ == "__main__":
    unittest.main()

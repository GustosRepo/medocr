# config/rules/loader.py
import json, os, functools

BASE_DIR = os.path.dirname(__file__)

@functools.lru_cache(maxsize=None)
def load_json(name, default=None):
    path = os.path.join(BASE_DIR, name)
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}

@functools.lru_cache(maxsize=None)
def load_txt(name):
    path = os.path.join(BASE_DIR, name)
    try:
        with open(path) as f:
            return [line.strip() for line in f if line.strip() and not line.startswith("#")]
    except Exception:
        return []
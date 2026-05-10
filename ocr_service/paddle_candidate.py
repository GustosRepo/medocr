"""
Optional PaddleOCR 3.x candidate adapter for local MEDOCR experiments.

This module is intentionally not imported by the production OCR service. It is
used by benchmark scripts so PaddleOCR can be tested side-by-side with the
current RapidOCR path before any production switch is made.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image


@dataclass
class PaddleLine:
    text: str
    confidence: float
    box: Optional[Any] = None


class PaddleCandidateUnavailable(RuntimeError):
    pass


def _load_paddleocr():
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on optional install
        raise PaddleCandidateUnavailable(
            "PaddleOCR is not installed. Install optional deps with "
            "`python -m pip install -r ocr_service/requirements.paddle.txt`."
        ) from exc
    return PaddleOCR


def _as_numpy(image: Image.Image | np.ndarray) -> np.ndarray:
    if isinstance(image, Image.Image):
        return np.array(image.convert("RGB"))
    return image


def _flatten_result(result: Any) -> List[PaddleLine]:
    """
    Normalize PaddleOCR 2.x/3.x output variants into a stable list of lines.

    PaddleOCR output has changed across releases and pipelines. This parser is
    deliberately defensive so benchmark failures expose model/runtime behavior,
    not minor shape drift.
    """
    lines: List[PaddleLine] = []

    def visit(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, dict):
            text = node.get("text") or node.get("rec_text") or node.get("transcription")
            score = node.get("confidence") or node.get("score") or node.get("rec_score")
            box = node.get("box") or node.get("bbox") or node.get("points")
            if text:
                try:
                    conf = float(score) if score is not None else 0.0
                except Exception:
                    conf = 0.0
                lines.append(PaddleLine(str(text), conf, box))
                return
            for value in node.values():
                visit(value)
            return

        if isinstance(node, (list, tuple)):
            # Common classic OCR shape: [box, (text, score)]
            if len(node) >= 2 and isinstance(node[1], (list, tuple)) and len(node[1]) >= 2:
                text = node[1][0]
                score = node[1][1]
                box = node[0]
                if isinstance(text, str):
                    try:
                        conf = float(score)
                    except Exception:
                        conf = 0.0
                    lines.append(PaddleLine(text, conf, box))
                    return

            # Some output shapes include direct [text, score, box].
            if len(node) >= 2 and isinstance(node[0], str):
                try:
                    conf = float(node[1])
                except Exception:
                    conf = 0.0
                lines.append(PaddleLine(node[0], conf, node[2] if len(node) > 2 else None))
                return

            for item in node:
                visit(item)

    visit(result)
    return [line for line in lines if line.text.strip()]


class PaddleOcrCandidate:
    def __init__(
        self,
        *,
        lang: str = "en",
        use_doc_orientation_classify: bool = True,
        use_doc_unwarping: bool = False,
        use_textline_orientation: bool = True,
        **kwargs: Any,
    ) -> None:
        PaddleOCR = _load_paddleocr()

        # PaddleOCR 3.x accepts these names. Older versions may reject them, so
        # fall back to a minimal constructor for quick local experimentation.
        try:
            self.engine = PaddleOCR(
                lang=lang,
                use_doc_orientation_classify=use_doc_orientation_classify,
                use_doc_unwarping=use_doc_unwarping,
                use_textline_orientation=use_textline_orientation,
                **kwargs,
            )
        except TypeError:
            self.engine = PaddleOCR(lang=lang, **kwargs)

    def recognize(self, image: Image.Image | np.ndarray) -> Dict[str, Any]:
        arr = _as_numpy(image)
        start = time.perf_counter()

        if hasattr(self.engine, "predict"):
            raw = self.engine.predict(arr)
        else:
            raw = self.engine.ocr(arr, cls=True)

        elapsed_ms = (time.perf_counter() - start) * 1000
        lines = _flatten_result(raw)
        text = "\n".join(line.text for line in lines)
        confidences = [line.confidence for line in lines]

        return {
            "engine": "paddleocr",
            "elapsed_ms": elapsed_ms,
            "text": text,
            "lines": [
                {"text": line.text, "confidence": line.confidence, "box": line.box}
                for line in lines
            ],
            "avg_confidence": sum(confidences) / len(confidences) if confidences else 0.0,
            "raw": raw,
        }


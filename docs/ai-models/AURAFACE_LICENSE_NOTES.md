# AuraFace-v1 — License and Acquisition Notes

This document records the legal basis and acquisition procedure for the AuraFace-v1
face recognition model used in this platform under `FACE_ENGINE=auraface`.

---

## Model Identity

| Field | Value |
|---|---|
| Model name | AuraFace-v1 |
| HuggingFace repository | `fal/AuraFace-v1` |
| Publisher | FAL.AI (fal.ai) |
| Architecture | ArcFace-style 512-dimensional identity encoder |
| Published license | Apache-2.0 |
| HuggingFace URL | https://huggingface.co/fal/AuraFace-v1 |

---

## Why AuraFace Was Chosen

This platform previously evaluated InsightFace models (SCRFD detector + ArcFace
buffalo_l/buffalo_s embedder). InsightFace's model zoo README explicitly restricts
use to "non-commercial research purposes only," making those models unsuitable as
the primary path for a commercial enterprise attendance platform.

AuraFace-v1 is published under Apache-2.0, which explicitly permits:

- **Commercial use** ✓
- **Distribution** ✓
- **Modification** ✓
- **Private use** ✓

FAL.AI has positioned AuraFace as a commercially-friendly alternative to
InsightFace models. Their public communications describe it as designed for
production use in commercial face recognition applications.

The SCRFD detector (public/models/onnx/scrfd.onnx) continues to come from
InsightFace and retains the non-commercial research restriction. The SCRFD model
is used only for face detection and landmark output — it is not embedded in
customer-facing biometric templates. Evaluate whether this is acceptable for
your deployment. As an alternative, any ONNX-exported detector that outputs
5-point facial landmarks can replace SCRFD without code changes.

---

## License Evidence (Capture Date: 2026-06-24)

The following was verified at the time of integration:

1. **HuggingFace model card license field:** `apache-2.0`  
   (visible at https://huggingface.co/fal/AuraFace-v1 under the "License" tag)

2. **FAL.AI commercial positioning:** The model is described in FAL.AI's public
   communications as a commercially-usable face recognition model.

3. **Apache-2.0 scope:** The license declaration on a HuggingFace model repository
   applies to the model artifact (weights, configuration files) published in that
   repository by the publisher (FAL.AI).

---

## Remaining Legal Risks

Apache-2.0 on the model weights is a significantly better position than InsightFace's
explicit non-commercial restriction. However, the following risks remain and must be
evaluated before large-scale commercial deployment:

### Risk 1 — Training Data Provenance (MEDIUM)

Apache-2.0 licenses the artifact FAL.AI is distributing. It does not independently
license the training data used to train the model. If AuraFace was trained on
academic datasets with non-commercial restrictions (VGGFace2, CASIA-WebFace,
MS-Celeb-1M, WebFace600K), those datasets' terms may affect the model as a
derivative work. International AI/IP law on this question is not settled as of 2025.

**Action required before large-scale deployment:**
- Read the "Training Data" section of the AuraFace-v1 model card
- If FAL.AI used a proprietary or permissively-licensed dataset, document it here
- If the training data is restricted academic datasets, obtain a legal opinion on
  whether the Apache-2.0 model license is sufficient for your jurisdiction

### Risk 2 — Biometric Data Regulation (SEPARATE FROM MODEL LICENSE)

The model license does not address biometric data regulations. Face recognition
systems are regulated independently in multiple jurisdictions:

- **EU GDPR / EU AI Act:** Face recognition in employment contexts requires a
  lawful basis, Data Processing Agreement (DPA), and may require a DPIA
- **Illinois BIPA:** Requires written consent and a biometric data retention policy
- **China PIPL:** Explicit consent for biometric data processing
- **Other national laws:** Check local requirements for your deployment country

These regulations apply regardless of the model license.

### Risk 3 — Model Accuracy Verification (OPERATIONAL)

AuraFace accuracy has not been independently validated in this platform against a
labeled test dataset. Do not assume NIST-level accuracy without measurement.
Before commercial deployment, run accuracy benchmarks with enrolled employees and
document False Accept Rate (FAR) and False Reject Rate (FRR) at the configured
threshold.

---

## Acquisition Procedure

### Step 1 — Obtain ONNX export

If FAL.AI publishes a pre-exported `.onnx` file in the HuggingFace repository,
download it directly from https://huggingface.co/fal/AuraFace-v1/tree/main.

If only PyTorch weights (`.safetensors` or `.pth`) are published, export to ONNX:

```bash
pip install torch transformers onnx onnxruntime
python -c "
from transformers import AutoModel
import torch

model = AutoModel.from_pretrained('fal/AuraFace-v1', trust_remote_code=True)
model.eval()
dummy = torch.zeros(1, 3, 112, 112)

torch.onnx.export(
    model,
    dummy,
    'auraface.onnx',
    opset_version=14,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={'input': {0: 'batch'}, 'output': {0: 'batch'}},
)
print('Export complete. Output: auraface.onnx')
"
```

Verify the export produces a 512-d output:
```bash
python -c "
import onnxruntime as ort
import numpy as np
sess = ort.InferenceSession('auraface.onnx')
dummy = np.zeros((1, 3, 112, 112), dtype=np.float32)
out = sess.run(None, {sess.get_inputs()[0].name: dummy})
print('Output shape:', out[0].shape)  # expect (1, 512)
"
```

### Step 2 — Record checksum

```bash
sha256sum auraface.onnx
```

Add the result to `public/models/onnx/CHECKSUMS.sha256` (that file IS committed
to git, the model file is NOT).

### Step 3 — Place the model file

```
public/models/onnx/auraface.onnx
```

This directory is in `.gitignore`. Do not commit the binary file.

### Step 4 — Verify via debug panel

1. Set `VITE_FACE_ENGINE=auraface` in `.env`
2. Run `npm run dev`
3. Open `/admin/face-debug` as platform admin
4. Select a company and camera
5. Expected engine info panel:
   ```
   Engine      auraface
   Detector    scrfd
   Embedder    auraface
   Emb. dim    512
   Alignment   5-point affine (SCRFD landmarks)
   ```
6. If Step 6 (engine init) shows FAIL: model file is missing or corrupt

---

## Normalization Verification (Required Before Production)

The `AuraFaceEmbedderEngine` uses `(pixel − 127.5) / 128` — ArcFace-standard
preprocessing. This must be confirmed against the AuraFace-v1 model card's
"Preprocessing" section before trusting recognition accuracy.

If the model card specifies different normalization (e.g. ImageNet statistics:
`mean=[0.485, 0.456, 0.406]`, `std=[0.229, 0.224, 0.225]` applied after dividing
by 255), update `PIXEL_MEAN` and `PIXEL_STD` in
`src/features/faceRecognition/engines/auraFaceEmbedderEngine.ts` and
re-enroll all employees with the corrected constants.

Incorrect normalization produces embeddings silently (no error) with severely
degraded recognition accuracy.

---

## Production Deployment Checklist

Before using `FACE_ENGINE=auraface` in production for paying customers:

- [ ] Training data provenance confirmed and documented in this file
- [ ] Legal review completed (or explicit business acceptance of remaining risk)
- [ ] Biometric regulations assessed for target deployment countries
- [ ] Normalization constants verified against model card
- [ ] ONNX file SHA-256 checksum recorded in CHECKSUMS.sha256
- [ ] Accuracy benchmarks run and FAR/FRR documented
- [ ] Employee re-enrollment completed with auraface engine
  (existing faceapi/arcface templates will not match auraface probes)
- [ ] `/admin/face-debug` shows engine=auraface, model loaded, landmarks=yes

---

_Last updated: 2026-06-24. Re-verify HuggingFace model card license field before
any new major deployment. License declarations can change if the model is updated._

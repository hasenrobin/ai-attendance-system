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

## Why AuraFace Was Selected Over InsightFace Models

This platform previously evaluated InsightFace models (SCRFD detector + ArcFace
buffalo_l/buffalo_s embedder). InsightFace's model zoo README explicitly restricts
use to "non-commercial research purposes only." That explicit restriction makes
those models unsuitable without a separate commercial license agreement.

The `fal/AuraFace-v1` repository is licensed under Apache-2.0. The Apache-2.0
license, as applied to the published repository artifacts, explicitly permits:

- **Commercial use** ✓
- **Distribution** ✓
- **Modification** ✓
- **Private use** ✓

**Important:** The Apache-2.0 license covers the repository artifacts as published
by FAL.AI. It does not independently resolve questions about the licensing of the
training data used to produce those artifacts. That review is a separate step
required before commercial production deployment. See "Remaining Legal Risks" below.

The SCRFD detector bundled in the AuraFace repository (`scrfd_10g_bnkps.onnx`) is
also distributed under the same Apache-2.0 license declaration. The SCRFD model
is used only for face detection and landmark output — it is not embedded in
biometric identity templates. Evaluate SCRFD's provenance separately if required.
Any ONNX detector that outputs 5-point facial landmarks can replace SCRFD without
code changes.

---

## License Evidence (Verified: 2026-06-24)

The following was confirmed at the time of integration:

1. **HuggingFace model card license field:** `apache-2.0`  
   (visible at https://huggingface.co/fal/AuraFace-v1 under the "License" tag)

2. **HuggingFace API metadata:** `"license": "apache-2.0"` returned by the model
   info API at https://huggingface.co/api/models/fal/AuraFace-v1

3. **LICENSE.md in repository:** Contains the full Apache License 2.0 text.

4. **Apache-2.0 scope:** The license declaration applies to the model artifacts
   (weights, ONNX files, configuration) published by FAL.AI in this repository.
   It does not constitute a warranty or legal clearance of the training data.

**Note:** License declarations on HuggingFace can change. Re-verify the license
field before any new major deployment. Screenshot or archive the model card if
documentary evidence is required for compliance records.

---

## Remaining Legal Risks

The following risks must be evaluated before commercial production deployment.
They are separate from the Apache-2.0 repository license and are not resolved
by it:

### Risk 1 — Training Data Provenance (REQUIRED REVIEW)

The Apache-2.0 license applies to the repository artifacts as published by FAL.AI.
It does not independently license the training data used to produce the model
weights. The AuraFace-v1 model card describes the training data as "commercially
and publicly available face images" but does not name specific datasets or provide
dataset licenses. Until the training data is documented and reviewed, a definitive
statement about commercial clearance cannot be made.

If AuraFace weights were derived from academic datasets with non-commercial
restrictions (VGGFace2, CASIA-WebFace, MS-Celeb-1M, WebFace600K), those datasets'
terms may be relevant regardless of the repository's Apache-2.0 declaration.
International AI/IP law on training data and model weight provenance is not settled
as of 2025.

**Action required before production deployment:**
- Read the "Training Data" section of the AuraFace-v1 model card
- Contact FAL.AI to confirm the datasets used and their licensing terms
- Document the confirmed training data in this file under a "Training Data Confirmed" section
- If the training data cannot be confirmed as permissively licensed, obtain a legal
  opinion before proceeding with commercial deployment

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

**License and legal:**
- [ ] AuraFace repository license (Apache-2.0) confirmed current on HuggingFace
- [ ] Training data provenance confirmed with FAL.AI and documented in this file
- [ ] Legal review or explicit written business decision recorded re: training data risk
- [ ] Biometric data regulations assessed for all target deployment countries

**Technical:**
- [ ] Normalization constants verified against AuraFace-v1 model card
- [ ] ONNX file SHA-256 checksums match `public/models/onnx/CHECKSUMS.sha256`
- [ ] `node scripts/dev/verify-auraface.mjs` passes all checks
- [ ] `/admin/face-debug` shows engine=auraface, model loaded, landmarks=yes
- [ ] Accuracy benchmarks run; FAR and FRR documented at configured threshold

**Data:**
- [ ] Employee re-enrollment completed using the auraface engine
  (existing faceapi/arcface templates will not match auraface probes)

---

_Last updated: 2026-06-24. This document records what was known at the time of
integration and what remains to be confirmed. It is not a legal clearance document.
Re-verify the HuggingFace model card license field before any new major deployment;
license declarations can change when a model is updated._

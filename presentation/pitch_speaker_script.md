# MedTwin pitch: speaker script (mentor and HOD)

What to say with `MedTwin_Pitch_Deck.pptx`; the same text is in each slide's speaker notes. Say it in your own words; the times are a guide.

Talk length: about 18 minutes, plus questions and an optional live demo.

## Before you present

- Fill in the placeholders on slides 1 and 20: your name or team, your mentor's name, department, college and date.
- Keep the app running in a browser for the live demo (see the README's quick start).
- If time is short, shorten slides 5, 11 and 17. Slides 8–9 (why U-Net) and 14–16 (hospital implementation) are the heart of this talk.

## Timing plan

| # | Slide | Time | Starts at |
| --- | --- | --- | --- |
| 1 | MedTwin | 0:30 | 0:00 |
| 2 | The problem | 0:55 | 0:30 |
| 3 | Our solution | 0:55 | 1:25 |
| 4 | Where MedTwin fits | 0:55 | 2:20 |
| 5 | System architecture | 0:55 | 3:15 |
| 6 | How it works | 1:00 | 4:10 |
| 7 | How we built the AI | 1:00 | 5:10 |
| 8 | Why a 3D U-Net | 1:05 | 6:10 |
| 9 | U-Net vs other options | 0:55 | 7:15 |
| 10 | Results | 1:00 | 8:10 |
| 11 | The 3D digital twin | 0:50 | 9:10 |
| 12 | The doctor's workflow | 1:00 | 10:00 |
| 13 | The report | 0:50 | 11:00 |
| 14 | Deployment architecture | 1:00 | 11:50 |
| 15 | Implementation step by step | 1:05 | 12:50 |
| 16 | What a hospital needs | 0:50 | 13:55 |
| 17 | Tested, not just built | 0:50 | 14:45 |
| 18 | Future scope | 0:55 | 15:35 |
| 19 | Impact | 0:40 | 16:30 |
| 20 | Questions | 0:30 | 17:10 |

## Script

### 1. MedTwin (0:30)

Good morning, sir and madam. Our project is MedTwin. MedTwin takes a patient's brain MRI, uses a 3D AI model to find the brain tumour, measures it, and builds a 3D model of that patient's brain, which we call a digital twin. The doctor checks it, corrects it if needed, and signs the report.

It is a working system with 62 automated tests passing. I will explain the problem, how our solution works, why we chose a U-Net, what the doctor sees, and, most importantly, how it can be implemented in any hospital.

### 2. The problem (0:55)

Glioma is a serious brain tumour. To plan treatment and follow-up, doctors need the size of each part of the tumour.

For one patient the MRI has four sequences of 155 slices each: 620 images. Outlining the tumour by hand on these is slow, two experts often draw different outlines, and so the most important follow-up question, 'is the tumour growing?', is hard to answer with exact numbers.

AI models for this exist, but they stay in research code. They need clean research files, they do not give the measurements doctors use, and a doctor cannot check, correct or sign their output. That is the gap MedTwin fills.

### 3. Our solution (0:55)

Here is the whole idea in one picture. The input is the patient's four MRI sequences, straight from the scanner as DICOM, or as NIfTI files.

MedTwin then does four things: the AI segments the tumour, it reconstructs the brain and tumour in 3D, it measures everything, and it writes a report. For a prepared case this takes about 20 to 35 seconds on a small laptop GPU.

The outputs are a 3D digital twin, the tumour map on every slice, a printable report, and the numbers doctors use. For this test patient: enhancing tumour 50.8 cubic centimetres, necrotic core 23.6, oedema 152.5, and a RANO measurement of 4,055 square millimetres.

Our principle: AI suggests, the doctor decides. Nothing is final until the doctor signs.

### 4. Where MedTwin fits (0:55)

This is the normal hospital flow, and where MedTwin fits into it. The patient is scanned, the MRI scanner produces four sequences, and the study is stored in the PACS, the hospital's image archive.

MedTwin sits right after the PACS. It prepares the outline, the 3D model, the numbers and a draft report. The radiologist then reviews, corrects and signs, and the clinician receives the signed report. When the patient comes back for a follow-up scan, it goes through the same flow, and MedTwin compares it with the earlier scans.

So we do not change how the hospital works. Today the radiologist reads every slice and measures by hand. With MedTwin, the work is ready when they open the case; their job becomes checking and signing.

### 5. System architecture (0:55)

Technically, MedTwin has three parts. On the left, the doctor's browser: nothing to install. The doctor uploads a study, watches the progress, works in the 3D and slice viewers, corrects with a brush, signs off and prints the report.

In the middle, a FastAPI server. It provides the API, accounts and roles, the audit trail and security log, and a queue so only one analysis uses the GPU at a time.

On the right, the MedTwin pipeline, our Python package, which does the real work in eight steps on the GPU. Everything for a case is stored together. The main open-source libraries are listed at the bottom.

### 6. How it works (1:00)

Here is the pipeline after one click. Step 0 reads the DICOM study, finds the MRI series, suggests which is T1, T1 contrast, T2 and FLAIR, and never reads patient identifiers. Step 1 checks the four sequences. Step 2 aligns them and removes the skull with HD-BET when needed. Step 3 applies exactly the preprocessing used in training. Step 4 is the AI: the 3D U-Net segments the tumour and gives a confidence map.

Along the bottom row: step 5 builds the 3D brain, step 6 measures volumes, location, separate lesions and RANO diameters, with safety checks, step 7 builds the tumour meshes and step 8 writes the report. If the doctor corrects the outline, steps 6 to 8 rerun in about 3 seconds.

A prepared case takes about 20 to 35 seconds on a 2 GB laptop GPU; a raw hospital study that needs skull stripping takes about 5 minutes on the CPU.

### 7. How we built the AI (1:00)

This is how we built the AI, step by step. We used the BraTS 2023 adult glioma dataset: 1,251 scans, each with four sequences and an expert's label for every voxel. We checked all 6,255 files, then preprocessed them the same way every time: same orientation, 1-millimetre voxels, normalised brightness, cropped and padded.

We split the scans into 875 for training, 188 for validation and 188 for testing. The 3D U-Net trained for 50 epochs with a Dice plus cross-entropy loss and the Adam optimiser. After every epoch we scored it on the validation set and kept the best: 0.8011 at epoch 44. That model scored a mean Dice of 0.78 on the 188 test scans, and it is packed into a model bundle, 4.6 megabytes of weights plus settings, which the app loads.

Training took 42.8 hours on a laptop GPU, and the curve shows the score levelling off near 0.80.

### 8. Why a 3D U-Net (1:05)

Why did we choose a U-Net? The diagram shows its U shape. The encoder on the left shrinks the scan step by step and learns WHAT is in it; the decoder on the right grows it back and works out WHERE exactly each part is. The dashed skip connections copy fine detail across, so the tumour edges stay sharp.

Six reasons. One, U-Net was designed for biomedical segmentation and works with a limited number of labelled scans; we had 875 to train on. Two, exact outlines, thanks to the skip connections, and we need exact outlines to measure volume. Three, the 3D version uses the slices above and below. Four, it is small: 1.19 million parameters, so it runs on a 2 GB laptop GPU. Five, it is proven: most top BraTS methods, including nnU-Net, are U-Net-style networks. Six, MONAI gives a tested implementation, and we can upgrade later to nnU-Net or a Transformer without changing the rest of the system.

### 9. U-Net vs other options (0:55)

This table compares the options against our goal: exact 3D volumes, trained on about a thousand labelled scans, on modest hardware.

Classic thresholding needs no training, but it breaks when the scanner or contrast changes. A 2D network that works slice by slice misses the 3D shape. Box detection like YOLO only draws a box, so there is no volume. Transformers such as Swin UNETR are powerful, but they usually need more data or pre-training and much more memory. nnU-Net is itself a U-Net that configures itself and is very strong, but it needs a bigger GPU to train.

The 3D U-Net is the only option that ticks every box today. nnU-Net and Transformers are our next experiments, and our pipeline is built so we can swap the model without changing anything else.

### 10. Results (1:00)

The results. On the 188 held-out test scans, the mean Dice score is 0.78 and the mean IoU is 0.69. Dice measures how much the AI's outline overlaps the expert's, where 1 is perfect. For doctors, volume matters most: whole-tumour volume agrees with the experts with an ICC of 0.98.

On the left is one test patient in 3D, our AI next to the expert's outline. For this scan the whole-lesion Dice is 0.97.

The chart is honest about our weak spot: the necrotic core agrees less, 0.52, mainly because of a few scans with very large necrotic cores. A stronger model and more training examples are the fix, which I will show in the future plan.

### 11. The 3D digital twin (0:50)

This is the digital twin of one test patient. MRI scans are too coarse to show the brain's folds, so MedTwin takes a standard folded brain, FreeSurfer's fsaverage template, and fits it to the patient: it scales and aligns it, then warps the gyral crowns onto the patient's own brain outline. For this patient the average distance dropped from 7.08 to 3.81 millimetres. The cerebellum and brainstem come from the scan, and the tumour regions are added as colour-coded meshes in real millimetres.

The doctor can cut through it, change opacity, hover for details and download STL files, for example for 3D printing or surgical planning. The folds are the template's, so there is also an exact view straight from the scan.

### 12. The doctor's workflow (1:00)

This swimlane shows who does what. The top lane is the doctor, the bottom lane is MedTwin.

The doctor signs in with their own account and uploads the DICOM zip with a patient code. MedTwin detects the series and suggests which is which, with thumbnails. The doctor confirms, and MedTwin runs the eight-step analysis with live progress. The doctor inspects the result in 3D and on the slices and corrects anything with the brush; MedTwin recalculates volumes, meshes and the report in about 3 seconds. Finally the doctor approves, or rejects with a reason, and MedTwin records everything in the audit trail and on the patient's follow-up timeline.

In our follow-up test, the enhancing tumour grew from 12.3 to 50.8 cubic centimetres, and MedTwin reported radiographic progression automatically.

### 13. The report (0:50)

This is a real report produced by MedTwin for a test patient, before review. The top clearly says it is AI decision support and not yet reviewed.

It gives the volume of each region and its share of the brain, the location in plain words, the model's confidence, and the RANO measurement: 75.1 by 54.0 millimetres, product 4,055 square millimetres, the standard measurement in neuro-oncology. It lists separate lesions, and after review it shows who approved it, with a signature block.

While testing we found that the original research code reported the tumour side inverted, left for right. We fixed it in the app and checked the location against the raw scan.

### 14. Deployment architecture (1:00)

This is how MedTwin sits inside a hospital. Everything stays on the hospital's own network; nothing goes to the cloud.

The MRI scanner sends DICOM to the PACS archive, as it does today. One PC with an NVIDIA GPU runs the MedTwin server. Today, the study is exported from the PACS as a zip and uploaded; the next step is automatic sending from the PACS to MedTwin, and sending the results back to the PACS. Doctors use their existing workstations: radiologists review, correct and sign, clinicians view, and an administrator manages accounts, all through the browser over HTTPS.

Security is built in: identifiers are never read, passwords are hashed with lockout, recovery works without email, sessions are protected, every action is audited, and a revision check stops one doctor from overwriting another's work.

### 15. Implementation step by step (1:05)

How would a hospital actually adopt MedTwin? In six steps, the traditional way new tools enter radiology.

Step one, install: one GPU PC in the radiology department, run the network start script, create the administrator and doctor accounts. This already works today. Step two, a silent pilot: MedTwin runs alongside normal reporting and radiologists compare its results with their own, with no clinical decisions based on it. Step three, local validation: test on the hospital's own scanners against radiologists' outlines, with ethics committee approval. Step four, train the team. Step five, connect it to the PACS and the hospital login. Step six, go live and keep monitoring: the doctor signs every case, everything is audited, and feedback improves the model.

Before AI results guide clinical decisions, regulatory clearance from CDSCO is needed. To reach every hospital: large hospitals run their own server, and smaller ones can share a regional server, hub and spoke.

### 16. What a hospital needs (0:50)

What does a hospital need to start? Very little. Hardware: one PC with an NVIDIA GPU; 2 GB already works, and with 4 GB or more the skull-stripping step also runs on the GPU; on a desktop GPU that takes under a minute instead of about five. Doctors keep using their existing PCs.

Software: Windows, the Python environment and MedTwin, all built on open-source libraries, plus a hospital certificate for HTTPS and disk encryption for stored cases. People: one administrator, the radiologists who review and sign, and clinicians with read-only access, after a short training.

Approvals: the ethics committee for the pilot, regulatory clearance before clinical use, and for any commercial version we would replace HD-BET, whose weights are non-commercial, with SynthStrip.

### 17. Tested, not just built (0:50)

For a hospital, reliability matters as much as accuracy. MedTwin has 62 automated tests: unit tests, clinical tests such as RANO diameters and brush strokes landing on the right voxel, account and password-recovery tests, and a regression test on a real patient.

Testing found real problems. The original research code reported the tumour side inverted; we fixed it and checked against the raw scan. Skull stripping was checked at Dice 0.97, and a hospital-style DICOM study was read correctly. In one test the skull was not removed and the model outlined 1,315 cubic centimetres of 'oedema'; now that is detected and flagged 'do not use'. And all three roles were tested in the browser.

### 18. Future scope (0:55)

Where does MedTwin go next? Three directions.

Smarter AI: compare nnU-Net and Transformer models, add data augmentation and more varied data, fine-tune on each hospital's own scans, and report accuracy for every tumour region. This also fixes the necrotic-core weak spot.

A deeper hospital link: receive studies from the PACS automatically, send results back as DICOM SEG and structured reports, and connect to the radiology worklist and hospital login.

More diseases and a smarter twin: meningioma, metastases, stroke and multiple sclerosis; anatomy such as which lobe is affected and how close the tumour is to critical areas; and a predictive twin that models tumour growth from follow-up scans.

To reach every hospital we need regional hub servers, the medical-device quality standards, and CDSCO approval.

### 19. Impact (0:40)

So why does it matter? MedTwin gives fast, consistent tumour measurements and a 3D view a doctor can trust, on a low-cost laptop GPU, inside the hospital.

Doctors review and correct instead of outlining from scratch. Patients get consistent follow-up and a 3D view that helps them understand their treatment. Hospitals can run it on modest hardware on their own network, with no cloud upload, which protects privacy and suits hospitals with limited budgets.

### 20. Questions (0:30)

To summarise: MedTwin is a working, tested system that takes a brain MRI to a measured 3D digital twin and a signed report, and it fits into the normal hospital flow.

To take it into a hospital we need three things: a pilot hospital willing to run the silent pilot, local scans with radiologist outlines to validate and fine-tune the model, and a stronger GPU for the next models. With your support, sir and madam, we would like to start with a pilot.

Thank you. We are happy to take questions or show MedTwin live.

## Questions your mentor or HOD may ask

| Question | Suggested answer |
| --- | --- |
| Why U-Net and not something newer? | U-Net was designed for biomedical segmentation, gives exact outlines, works with about a thousand labelled scans and fits a 2 GB GPU. Newer options (Transformers, nnU-Net) need more data or a bigger GPU; they are our next experiments, and the pipeline lets us swap the model without changing anything else. |
| Is 0.78 Dice good enough? | It is the mean over three separate tumour labels, which is a strict measure. Whole-tumour volume agrees with experts at ICC 0.98, which is what matters for follow-up. The weak spot is the necrotic core in very large tumours; nnU-Net, augmentation and more data are the fix. And a doctor reviews every result. |
| Were the test scans completely new to the model? | They were never used for training. A few BraTS patients have two scans, and our split was by scan, so 28 of the 188 test scans come from patients who also had a scan in training or validation. Splitting by patient is part of the next round of training. |
| How do we put this in a hospital that has no GPU? | Two options: buy one PC with an NVIDIA GPU (2 GB works), or share a regional hub server over a secure network (hub and spoke). |
| Is patient data safe? | Identifiers in DICOM files are never read, DICOM files are deleted after conversion, and everything stays on the hospital network over HTTPS, with roles, password hashing, lockout and an audit trail. Stored cases should be on an encrypted disk (BitLocker). |
| Can doctors trust the AI? | They do not have to trust it blindly: they see a confidence map, can correct anything with the brush, and nothing is final until they sign. The report says clearly that it is decision support. |
| Is it approved for clinical use? | Not yet. It needs a local validation study with ethics approval and regulatory clearance (CDSCO). Our rollout plan starts with a silent pilot so no clinical decision depends on it until then. |
| How is it different from existing tools? | It is open, runs on low-cost hardware inside the hospital, covers the whole flow from DICOM to a signed report with a 3D twin and follow-up, and keeps the doctor in control. |
| What did you build yourselves and what comes from libraries? | Libraries: PyTorch and MONAI (network and training), SimpleITK (DICOM, registration), HD-BET (skull stripping), trimesh (meshes), FastAPI (server), Three.js (3D view). The project's own code: training set-up, the medtwin package (pipeline, measurements, RANO, location, cortex fitting, meshes, report), the server (accounts, review, audit, queue), the web interface and the 62 tests. |

## Where the numbers come from

All numbers come from the project, read without changing anything: `README.md` (features, verification, roadmap, requirements), `research_paper/analysis/results/` (training history, volume agreement) and the stored app outputs for test scan 00449 (`medtwin_app/data/jobs/d43e76abdfac`: report, meshes). The images are real outputs: 3D renders of the stored meshes and a screenshot of the stored report. The U-Net comparison table is qualitative.

To rebuild: `presentation/source/make_assets.py` and `make_guide_assets.py` (with the app's Python), then `node presentation/source/build_pitch_deck.js`.

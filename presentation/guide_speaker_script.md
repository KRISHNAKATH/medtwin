# MedTwin project review: speaker script (for the guide)

What to say with `MedTwin_Project_Review.pptx`; the same text is in each slide's speaker notes. Say it in your own words; the times are a guide.

Talk length: about 16 minutes, plus questions. A live demo of the app after slide 18 works well if there is time.

## Before you present

- Fill in the placeholders on slides 1 and 18: your name, your guide's name, department, college and date.
- Keep slides 15 (limitations) and 14 (AI-assistance note). Guides value honesty, and it protects you in the viva.
- If time is short, shorten slides 5, 9 and 13.
- Have the app running in a browser in case your guide asks for a demo (see the README's quick start).

## Timing plan

| # | Slide | Time | Starts at |
| --- | --- | --- | --- |
| 1 | MedTwin: project review | 0:30 | 0:00 |
| 2 | The problem | 1:00 | 0:30 |
| 3 | Objectives | 0:55 | 1:30 |
| 4 | The journey | 1:00 | 2:25 |
| 5 | System architecture | 1:00 | 3:25 |
| 6 | The pipeline | 1:00 | 4:25 |
| 7 | The AI model | 1:00 | 5:25 |
| 8 | Results | 1:05 | 6:25 |
| 9 | The 3D digital twin | 0:55 | 7:30 |
| 10 | The report | 0:55 | 8:25 |
| 11 | The doctor stays in control | 1:00 | 9:20 |
| 12 | Hospital-ready | 0:55 | 10:20 |
| 13 | Tested, not just built | 0:50 | 11:15 |
| 14 | Research contribution | 1:00 | 12:05 |
| 15 | Honest limitations | 1:00 | 13:05 |
| 16 | Future scope | 1:05 | 14:05 |
| 17 | Why it matters | 0:45 | 15:10 |
| 18 | Questions | 0:30 | 15:55 |

## Script

### 1. MedTwin: project review (0:30)

Good morning, sir/madam. Today I will present my project, MedTwin. In one line: MedTwin takes a patient's brain MRI, finds the glioma tumour with a 3D AI model, measures it, and builds a 3D model of that patient's brain, which we call a digital twin. A doctor can then check it, correct it and sign it off.

The system itself is complete and tested, and the research paper draft is ready. I will cover four things: why I chose this problem, what I built, what it delivers, and what comes next.

### 2. The problem (1:00)

Glioma is the brain tumour this project covers. To plan treatment and follow-up, doctors need the size of each part of the tumour: the active enhancing part, the dead necrotic core and the swelling around it.

For one patient there are four MRI sequences, each with 155 slices: 620 images. Outlining the tumour by hand on these is slow, and two experts often draw different outlines, so the volumes vary. That makes it hard to answer the key follow-up question: is the tumour growing?

Many AI papers solve the segmentation part, but the model stays in a notebook. It needs clean research data, gives no clinical measurements, and has no way for a doctor to check or sign the result. That gap, from research model to a doctor's tool, is what I targeted.

### 3. Objectives (0:55)

I set six objectives. One: train a 3D AI model that outlines the three glioma regions. Two: turn the outline into the measurements doctors use: volumes, percentage of the brain, location in plain words, and RANO diameters, which are the standard measurement in neuro-oncology. Three: build a patient-specific 3D brain, the digital twin. Four: a web app a doctor can use from upload to signed report. Five: make it hospital-ready: DICOM files straight from the scanner, accounts for several doctors, and a secure network mode. Six: evaluate it honestly and write a research paper.

The first five are complete. The paper draft is ready; it needs a few final experiments before submission, which I will show at the end.

### 4. The journey (1:00)

This is how the project grew, in eight milestones. First I explored the BraTS 2023 dataset: 1,251 scans and 6,255 files, checked for shape, orientation and label problems. Then I trained the 3D U-Net for 50 epochs, which took 42.8 hours on my laptop GPU. Third, I wrote the measurement step and ran it on all 188 test scans. Fourth, the 3D reconstruction.

Then the bigger engineering part: the notebooks became one tested Python package and a web app, and I added the clinical tools, DICOM import, review, RANO and follow-up, and then multi-doctor accounts and security. The last milestone is the research paper, which is drafted. Green means done; yellow means draft ready.

### 5. System architecture (1:00)

The system has three parts. On the left is the doctor's browser: no installation, just a web page. The doctor uploads a DICOM zip or NIfTI files, watches the progress, then works in the 3D viewer and the slice viewer, corrects with a brush, reviews, signs off and prints the report.

In the middle is the FastAPI server. It provides the REST API, handles accounts and roles, keeps an audit trail and a security log, and runs a job queue so only one analysis uses the GPU at a time.

On the right is the MedTwin pipeline, my Python package that does the real work in eight steps. Everything for a case is stored together: results, meshes, slices, review status, audit trail and the report. The main libraries are listed at the bottom.

### 6. The pipeline (1:00)

Here is what happens after one click. Step 0 reads the DICOM study from the scanner, finds the MRI series, suggests which is T1, T1 contrast, T2 and FLAIR, and never reads patient identifiers. Step 1 checks the four sequences. Step 2 aligns them and removes the skull with HD-BET when needed. Step 3 applies exactly the preprocessing used in training. Step 4, the AI step, segments the tumour with the 3D U-Net and also produces a confidence map.

Then, coming back along the bottom row: step 5 builds the 3D brain, step 6 measures volumes, location, separate lesions and RANO diameters with safety checks, step 7 builds the tumour meshes and step 8 writes the report. If the doctor corrects the outline, steps 6 to 8 rerun in about 3 seconds.

A prepared case takes about 20 to 35 seconds on a 2 GB laptop GPU; a raw hospital study that needs skull stripping takes about 5 minutes on the CPU.

### 7. The AI model (1:00)

The AI core is a 3D U-Net from the MONAI library. It takes the four MRI sequences as four input channels and labels every voxel as background, necrotic core, oedema or enhancing tumour. It is deliberately compact, 1.19 million parameters, so it can run on a small laptop GPU.

I trained it on BraTS 2023 adult glioma data: 875 scans for training, 188 for validation and 188 for testing. The loss is Dice plus cross-entropy, which handles the fact that most voxels are background. Training took 50 epochs and 42.8 hours on an RTX 5050 laptop GPU.

The chart shows validation Dice rising from 0.54 to about 0.80 and levelling off after epoch 31. The best value, 0.8011 at epoch 44, is the checkpoint the app uses. Because it levelled off, more epochs alone will not help; a stronger model or augmentation would.

### 8. Results (1:05)

Now the results. On the 188 test scans the mean Dice score is 0.78 and the mean IoU is 0.69. Dice measures the overlap between the AI's outline and the expert's, where 1 is perfect. For doctors, volume matters most: whole-tumour volume agrees with the experts with an ICC of 0.98, and enhancing tumour 0.98 as well.

On the left you can see one test patient in 3D: the AI's result next to the expert's. The whole-lesion Dice for this scan is 0.97.

The chart on the right is honest about the weak spot: the necrotic core agrees much less, ICC 0.52, mainly because of a few scans with very large necrotic cores. I come back to this under limitations. One more point: 0.78 is averaged over separate labels, so it is not directly comparable with the region-based scores in BraTS papers.

### 9. The 3D digital twin (0:55)

This is the digital twin of one test patient. The scans are too coarse to show the brain's folds, so MedTwin takes a standard folded brain, FreeSurfer's fsaverage template, and fits it to the patient: it scales and aligns it, then warps the gyral crowns onto the patient's own brain outline. For this patient the average crown-to-surface distance dropped from 7.08 to 3.81 millimetres. The cerebellum and brainstem come from the scan itself, and the tumour regions are added as colour-coded meshes in real millimetres.

In the browser the doctor can cut through it, change opacity, hover for details, compare with expert wireframes and download STL files, for example for 3D printing. To be honest about it: the folds are the template's, not the patient's, so there is also an exact view straight from the scan.

### 10. The report (0:55)

This is a real report produced by MedTwin for a test patient, before any doctor has reviewed it. At the top it says clearly that this is AI decision support and not yet reviewed.

It lists the volume of each tumour region and its percentage of the brain, the location in plain words, and the model's average confidence. It gives the RANO bidimensional measurement: here 75.1 by 54.0 millimetres, a product of 4,055 square millimetres. It lists separate lesions, and after review it shows who approved or rejected the case, with a signature block.

One important fix: the original notebooks reported the tumour side and position inverted, left for right. The app computes the location in millimetres from the brain centre, and I checked it against the raw scan.

### 11. The doctor stays in control (1:00)

A key design principle: the AI suggests, the doctor decides. The doctor can correct the outline with a brush and eraser on any slice, and all measurements, meshes and the report recalculate in about 3 seconds. The doctor approves with name, role and time, or rejects with a reason, and any later edit reopens the case. Every analysis, correction and decision goes into an append-only audit trail.

For follow-up, scans are grouped by patient code. In my test with two scans, enhancing tumour went from 12.3 to 50.8 cubic centimetres, and MedTwin reported radiographic progression: plus 313% volume and plus 195% SPD.

Safety checks matter too. In one test the skull had not been removed, and the model outlined 1,315 cubic centimetres of 'oedema'. Now the skull is detected, and any outline over 40% of the brain gets a 'do not use' warning.

### 12. Hospital-ready (0:55)

MedTwin is designed for a hospital network. One computer with the GPU runs MedTwin; doctors open it from any browser over HTTPS on port 8443, with nothing to install. There are three roles: radiologists review, correct and sign; clinicians can view but not change; administrators manage accounts.

On security: patient identifiers in DICOM files are never read, and the DICOM files are deleted after conversion. Passwords are hashed with PBKDF2 and 260,000 iterations, and wrong attempts lock the account. Forgotten passwords work without email, through recovery codes or an administrator reset. Sessions and requests are protected, a revision check stops one doctor from overwriting another's work, and nothing leaves the hospital network.

I tested the DICOM path with a synthetic hospital-style study: all four series were recognised and the volumes matched the clean files closely.

### 13. Tested, not just built (0:50)

I did not want a demo that only works once, so the project has 62 automated tests: unit tests, clinical tests such as RANO diameters and brush strokes landing on the right voxel, account and password-recovery tests, and a regression test on a real patient. They run in their own data folder, so they never touch real accounts or cases.

Testing found real bugs. The biggest: the original notebooks reported the tumour side inverted. I fixed it and confirmed the position against the raw scan. HD-BET skull stripping was checked at Dice 0.97. The app runs on a 2 GB laptop GPU, and I tested all three roles in the browser, including that the clinician cannot change anything even through the API.

### 14. Research contribution (1:00)

The research side. The paper is drafted for Discover Artificial Intelligence, a Springer Nature journal. It is backed by a literature review of 62 papers and 86 references, each checked against Crossref, PubMed or arXiv records. The manuscript is 24 pages with five colour figures; you can see the title page and Figure 4 here.

I also added new analyses: an audit of the data split, volume agreement with the experts, and a failure analysis.

I position the contribution honestly: it is not a new segmentation algorithm. It is an open, clinician-in-the-loop workflow from DICOM to a signed report that runs on a 2 GB GPU. I should also tell you that the draft was prepared with AI assistance from my project files. Before submission I will verify every number, rewrite the Results and Discussion in my own words, and keep the AI declaration, as the journal's policy requires.

### 15. Honest limitations (1:00)

I want to be clear about what is not done yet, and how I plan to fix each item.

First, accuracy is shown only on BraTS research data, and the DICOM path was tested on one synthetic study, so a study on real hospital scans is needed. Second, my own audit found that the split was made per scan, not per patient: 28 of the 188 test scans come from patients who also had a scan in training or validation. I will re-split by patient. Third, very large necrotic cores are under-segmented. Fourth, I report only the mean Dice over labels, so I need region-wise Dice, HD95 and confidence intervals. Fifth, it covers only glioma. And sixth, it is decision support, not a clinically approved device, and the HD-BET weights are for non-commercial use only.

### 16. Future scope (1:05)

Here is the future plan in three steps.

Step 1 is finishing the research: re-split the data by patient and re-test, compare against nnU-Net, which is the standard strong baseline, report region-wise Dice and HD95 with confidence intervals, benchmark the runtime and check agreement with RANO measurements, and then submit the paper.

Step 2 is a hospital pilot: find a partner hospital, get ethics approval, and run a retrospective study against radiologists' outlines. For daily use it must also export to PACS, as DICOM SEG and structured reports, and connect to the hospital login.

Step 3 grows the platform: more diseases such as meningioma, metastases, stroke and multiple sclerosis; personal anatomy such as which lobe the tumour is in and its distance to critical areas; and a predictive twin that models tumour growth from follow-up scans. Commercial use would need licence-safe tools and the medical-device quality standards.

### 17. Why it matters (0:45)

So what is the purpose? MedTwin aims to give fast, consistent tumour measurements and a 3D view a doctor can trust, on a low-cost laptop GPU and inside the hospital.

For doctors, it means reviewing and correcting instead of outlining from scratch, with standard RANO numbers in the report. For patients, follow-up becomes consistent, and the 3D view helps explain the treatment. For hospitals, it runs on modest hardware on their own network, with no cloud upload, which matters for patient privacy and for hospitals with limited budgets.

### 18. Questions (0:30)

To summarise: the MedTwin system is complete and tested, from DICOM to a signed report with a 3D digital twin, and the paper draft is ready.

There are three things where your guidance would help most: reviewing the paper and planning the submission, helping me reach a partner hospital and the ethics committee for real-world validation, and access to a stronger GPU for the nnU-Net and re-split experiments.

Thank you. I am happy to take questions, or to show the app live.

## Questions your guide may ask

| Question | Suggested answer |
| --- | --- |
| What is new in your work? | Not a new segmentation algorithm. The contribution is a complete, clinician-in-the-loop system: DICOM to a signed report with volumes, RANO, a 3D twin, correction and audit, for several doctors, on a 2 GB GPU, plus an honest evaluation (split audit, failure analysis). |
| Why is your Dice (0.78) lower than BraTS leaders? | Small network (1.19 M parameters), no data augmentation, one split, and a stricter metric: the mean over separate labels, which is not comparable with region-wise WT/TC/ET scores. An nnU-Net baseline and region-wise metrics are the next experiments. |
| Is it really a digital twin? | It is a patient-specific 3D anatomical model with measurements that is updated with each follow-up scan. It does not yet predict tumour growth; a predictive twin is in the future scope. |
| What about data leakage? | My own audit found that 28 of the 188 test scans share a patient with training or validation, because the split was per scan. Volume agreement was similar on the 160 independent scans. Next: re-split by patient and re-score. |
| Is it clinically validated? | No. It is tested on research data and one synthetic hospital-style study. It needs a retrospective hospital study, ethics approval and regulatory clearance (CDSCO in India). The app labels itself as decision support. |
| How is patient privacy protected? | DICOM identifiers are never read, DICOM files are deleted after conversion, cases use pseudonymous codes, and everything runs on the hospital network over HTTPS with roles and an audit log. The app does not encrypt files at rest, so the computer should use BitLocker. |
| Why a U-Net and not a Transformer? | The U-Net is the proven baseline for 3D medical segmentation and fits a 2 GB GPU. Swin UNETR and nnU-Net are planned comparisons. |
| What is your own code and what comes from libraries? | Libraries: PyTorch and MONAI (network and training tools), SimpleITK (DICOM, registration), HD-BET (skull stripping), trimesh (meshes), FastAPI (server), Three.js (3D view). The project's own code: the training set-up, the medtwin package (pipeline, measurements, RANO, location, cortex fitting, meshing, report), the server (accounts, review, audit, queue), the web interface, the 62 tests and the evaluation analyses. |
| How long does an analysis take? | About 20–35 s per prepared case on the 2 GB MX550, and about 5 minutes for a raw DICOM study that needs skull stripping on the CPU. Training took 42.8 hours. These are not formal benchmarks; a runtime benchmark is planned. |
| Did you use AI to write the paper? | The draft was prepared with AI assistance from my project files and analyses. Under Springer Nature's policy I must verify every number, rewrite the Results and Discussion in my own words, and declare the AI use in the manuscript, and I will. |

## Where the numbers come from

All numbers come from the project, read without changing anything: `README.md` (features, verification, roadmap), `research_paper/01_project_review.md` and `research_paper/analysis/results/` (training history, split audit, volume agreement, error analysis), and the stored app outputs for test scan 00449 (`medtwin_app/data/jobs/d43e76abdfac`: report, meshes). The images on the slides are real outputs: 3D renders of the stored meshes, a screenshot of the stored report, and pages of the draft manuscript.

To rebuild: `presentation/source/make_guide_assets.py` (with the app's Python), `presentation/source/render_paper_pages.py` (any Python with PyMuPDF), then `node presentation/source/build_guide_deck.js`.

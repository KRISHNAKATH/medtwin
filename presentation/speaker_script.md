# MedTwin ML talk: speaker script

This is what to say with `MedTwin_ML_Explained.pptx` (the same text is in each slide's speaker notes). The audience is 1st and 2nd year students; no ML background is assumed. Speak it in your own words; the times are a guide.

Talk length: about 17 minutes, plus 3 minutes for questions.

## Before you present

- Put your name and the date on slide 1 (the "[Your name] · [Date]" line).
- Lines marked **[Ask the room]** are short questions to keep juniors involved. Skip them if you are short of time.
- Lines marked **[Advanced]** are optional extras for curious students or for questions.
- If you run long, shorten slides 6, 10 and 15. Don't skip slides 16 and 17: they are the most important lessons.

## Timing plan

| # | Slide | Time | Starts at |
| --- | --- | --- | --- |
| 1 | Teaching a computer to see brain tumours | 0:20 | 0:00 |
| 2 | Why teach a computer to outline tumours? | 0:50 | 0:20 |
| 3 | What is machine learning? | 1:10 | 1:10 |
| 4 | The input: one patient, four MRI images | 0:55 | 2:20 |
| 5 | The answer key: expert labels for every voxel | 0:55 | 3:15 |
| 6 | Three ways to see a tumour | 0:40 | 4:10 |
| 7 | Preprocessing | 0:55 | 4:50 |
| 8 | Convolution | 1:10 | 5:45 |
| 9 | The 3D U-Net | 1:20 | 6:55 |
| 10 | Softmax and argmax | 0:40 | 8:15 |
| 11 | The loss | 0:55 | 8:55 |
| 12 | Training | 0:55 | 9:50 |
| 13 | Watching it learn | 0:55 | 10:45 |
| 14 | Dice and IoU | 1:20 | 11:40 |
| 15 | Sliding-window inference | 0:40 | 13:00 |
| 16 | Data leakage | 0:55 | 13:40 |
| 17 | Where it fails | 1:05 | 14:35 |
| 18 | How to make it better | 0:55 | 15:40 |
| 19 | Five things to remember | 0:40 | 16:35 |

## Script

### 1. Teaching a computer to see brain tumours (0:20)

Hello everyone. Today I will show you the machine-learning part of our project, MedTwin. MedTwin takes a brain MRI scan and automatically outlines a brain tumour called a glioma, in 3D.

We will go step by step: from "what is machine learning?" up to the problems that real researchers worry about. You do not need any ML background. The picture on the right is the kind of output you will fully understand by the end: each colour is a different part of the tumour.

### 2. Why teach a computer to outline tumours? (0:50)

First, the problem. A glioma is a tumour that grows from the brain's own support cells, called glial cells. On MRI it has different parts: a dead centre called the necrotic core, an active rim that lights up when the patient gets contrast dye (the enhancing tumour), and swelling around it, called oedema.

Doctors want to know how big each part is, and whether it grows or shrinks between scans. Doing this by hand means drawing on every slice of a 3D scan. A BraTS scan has 155 slices, so it is slow, and two experts often draw slightly different outlines.

So our goal is: give the computer the MRI, and get back a coloured 3D map plus the volumes in about half a minute. A doctor then checks it and approves it.

### 3. What is machine learning? (1:10)

So what is machine learning? In normal programming, you write the rules. For example: "if the brightness is above 200, call it tumour". That breaks quickly, because every scanner and every tumour is different.

In machine learning we flip it around. We give the computer the data AND the correct answers, and it finds the rules by itself. The rules it learns are what we call the model.

This is called supervised learning, because every example comes with the correct answer, like a teacher supervising. Think of preparing for an exam: you study many solved problems, and then you can solve new ones. In MedTwin the solved examples are 875 MRI scans, each with an expert's outline of the tumour.

**[Ask the room]** Can anyone think of another example of supervised learning? (Spam filters, face unlock, handwriting recognition.)

### 4. The input: one patient, four MRI images (0:55)

Let's look at the input. For each patient we get four MRI images of the same brain, taken with different scanner settings.

T1 shows the anatomy. T1c is T1 after contrast dye is injected: the active tumour rim glows bright. T2 shows fluid as bright. FLAIR is like T2 but it darkens normal fluid, so swelling stands out.

Each sequence shows a different part of the tumour best, so we give all four to the model, stacked together as four channels, just like a colour photo has three channels: red, green and blue.

And these are 3D, so instead of pixels we have voxels: 3D pixels, each a 1-millimetre cube. One cropped scan in training was 128 by 168 by 136 voxels. That is about 2.9 million voxels for each channel.

### 5. The answer key: expert labels for every voxel (0:55)

Now the answers. For each training scan, experts gave every voxel a number: 0 for background, 1 for necrotic core, 2 for oedema and 3 for enhancing tumour. That is the answer key the model learns from.

The data comes from BraTS 2023, a public research challenge dataset with 1,251 labelled adult glioma scans. We split it into three parts: 875 scans for training (the study material), 188 for validation (practice tests that we use to choose the best version of the model), and 188 for testing (the final exam, used only once at the end).

Remember this split. It comes back in the advanced part.

### 6. Three ways to see a tumour (0:40)

There are three common vision tasks. Classification answers one question for the whole image: is there a tumour, yes or no. Detection draws a box around it. Segmentation goes further: it labels every single voxel. That is what MedTwin does.

You can think of segmentation as classification done millions of times, once for every voxel. That is why the output gives exact shapes and volumes, not just a box.

### 7. Preprocessing (0:55)

Before the model sees a scan, we clean it up so that every scan "speaks the same language".

One: orient. Rotate every scan to the same standard direction, called RAS: right, anterior, superior.
Two: resample. Make every voxel exactly 1 millimetre, because hospitals scan with different slice thicknesses.
Three: normalise. Scanners give different brightness numbers, so inside the head we subtract the mean and divide by the standard deviation, for each channel. That is the z-score from statistics.
Four: crop away the empty black background to save memory.
Five: pad each side to a multiple of 8, because the U-Net halves the size three times, and 2 × 2 × 2 is 8.

If we skip this, the model can end up learning the scanner instead of the tumour. In the full app there are also earlier steps: converting hospital DICOM files, aligning the four scans to each other, and removing the skull.

### 8. Convolution (1:10)

Now the core idea behind image models: convolution. Take a small grid of numbers, called a filter or kernel; here it is 3 by 3. Slide it over the image. At each position, multiply each filter number by the pixel under it, add everything up, and write one number into the output.

This filter has minus ones on the left and plus ones on the right, so it gives a big number exactly where dark changes to bright: an edge. The output is called a feature map. You can see the orange columns where the edge was found.

The important part: in a CNN, a convolutional neural network, nobody writes these numbers. The network learns them during training. Early layers learn simple things like edges, middle layers combine them into textures and rims, and deep layers respond to things like "this looks like enhancing tumour".

Because MRI is 3D, MedTwin uses 3D filters, 3 by 3 by 3, so the model also looks at the slices above and below.

### 9. The 3D U-Net (1:20)

The model is a 3D U-Net, named after its U shape.

The left side is the encoder. At each step it halves the size of the image and doubles the number of feature channels: 16, 32, 64, 128. Smaller image, richer description. It learns WHAT is in the scan, but it loses exact positions.

The right side is the decoder. It doubles the size back, step by step, to the original resolution, to work out WHERE exactly each part is.

The dashed lines are skip connections. They copy fine detail from the encoder straight across to the decoder, so the tumour edges stay sharp.

MedTwin's network takes 4 channels in and gives 4 classes out, and it has about 1.19 million learnable numbers, called parameters. It also uses residual units, which are shortcut paths that make training easier, and batch normalisation, which keeps the numbers in a stable range.

**[Advanced]** 1.19 million parameters is small for a 3D segmentation model. That is one reason it can run on a laptop GPU.

### 10. Softmax and argmax (0:40)

At the end, the network gives four raw scores for every voxel, one per class. Softmax turns these scores into probabilities that add up to 1.

In this made-up example voxel: 5% background, 10% necrotic, 15% oedema, 69% enhancing. Argmax just picks the biggest, so this voxel gets label 3, enhancing tumour.

The highest probability, 0.69, is what MedTwin shows as the "confidence" for that voxel. Keep that word, confidence, in mind. We will question it later.

### 11. The loss (0:55)

To learn, the model needs a score for how wrong it is. That score is called the loss. But there is a trap.

In this test scan, which has a big tumour, 93% of all voxels are background, and the necrotic core is only half a percent. A lazy model that says "background" everywhere would be 93% accurate, and completely useless. This is called class imbalance.

So MedTwin uses two losses together. Cross-entropy looks at every voxel and punishes it when the probability for the correct class is low, especially when the model was confident and wrong. Dice loss measures the overlap between the predicted tumour and the true tumour, so a small region counts just as much as a big one. The combination is called DiceCE loss.

### 12. Training (0:55)

Training is a loop. One, forward pass: feed in a scan and get a prediction. Two, loss: compare it with the expert's answer. Three, backpropagation: use calculus (the chain rule) to find how much each of the 1.19 million weights contributed to the error. Four, update: the Adam optimiser nudges every weight a tiny bit in the direction that reduces the error.

The size of that nudge is the learning rate, 0.0001, and a cosine schedule slowly lowers it towards zero so the model settles down at the end.

One full pass over all 875 training scans is called an epoch. We trained for 50 epochs, one whole 3D scan at a time because each scan is big. That is 43,750 updates. On a laptop RTX 5050 GPU it took about 43 hours.

One honest note: no data augmentation was used. We will come back to that.

### 13. Watching it learn (0:55)

How do we know it is learning? We watch two kinds of curves.

On the left is the loss: blue is training, orange is validation. Both fall fast at first. After about epoch 30, the validation loss stops improving while the training loss keeps going down. That widening gap is the start of overfitting: the model gets better at its study material without getting better at new scans.

On the right is the validation Dice score, which I will define on the next slide. Higher is better. It climbs from 0.54 to about 0.80 and then flattens.

We saved the model from the best epoch: epoch 44, with validation Dice 0.8011. That checkpoint is the one used in the app. This is why we need a validation set: to choose the model without touching the test set.

### 14. Dice and IoU (1:20)

Now, how good is it? Imagine the expert's outline and the AI's outline as two circles. Dice is two times the overlap, divided by the two sizes added together. IoU, intersection over union, is the overlap divided by everything covered by either one.

Toy example: the expert marks 100 voxels, the AI marks 100, and 80 overlap. Dice is 160 over 200, which is 0.80. IoU is 80 over 120, which is 0.67. Both are 1 for perfect and 0 for no overlap, and unlike accuracy they ignore the huge background.

On the 188 test scans, MedTwin got a mean Dice of 0.7822 and a mean IoU of 0.6939, averaged over the three tumour labels. For doctors, volume matters a lot: for whole-tumour volume, the agreement with the experts (ICC) was 0.98, where 1 is perfect. The images show a good case: the expert on the left and MedTwin on the right are almost the same.

**[Advanced]** BraTS research papers report scores on overlapping regions (whole tumour, tumour core, enhancing tumour), so our 0.78 over separate labels is not directly comparable with their numbers.

### 15. Sliding-window inference (0:40)

One practical problem: the app must run on a hospital laptop. Ours was tested on an NVIDIA MX550 with only 2 GB of GPU memory.

So instead of the whole scan at once, MedTwin cuts it into cubes of 96 by 96 by 96 voxels that overlap by half, predicts each cube, and blends the results back together. In the overlaps, the centre of each cube gets more weight than its edges (Gaussian weighting), because predictions near a cube's edge have less context.

**[Advanced]** The test score was measured with one pass over the whole volume, but the app uses windows. A complete evaluation would also score the exact setting the app uses.

### 16. Data leakage (0:55)

Now the advanced lessons: the things that matter in real research. First, data leakage.

Our split was done per scan, not per patient, and some patients have two scans. When we checked afterwards, 28 of the 188 test scans (about 15%) came from patients who also had a scan in training or validation. Same patient, same tumour: the tumour centres of these pairs were a median of 8.8 mm apart, against 61.4 mm for unrelated cases.

So for those 28 scans, the exam had partly seen the answers, and the test score may be optimistic. We do not know by how much yet.

The fix is simple: split by patient, so all scans of one person stay in one set, and report results on the 160 clean test scans. The lesson: a high score means nothing if the test set is not truly unseen.

### 17. Where it fails (1:05)

Second lesson: always look at where the model fails, not only at the average.

This chart shows the volume agreement with the experts for each tumour part. Whole tumour and enhancing tumour are excellent, about 0.98. But the necrotic core is only 0.52. Why?

Look at this test scan on the right. The expert marked a huge necrotic core, 172 cubic centimetres, in blue. MedTwin found only 6 and called most of it oedema, in yellow. Its whole-tumour outline is still very good (Dice 0.97), but the tumour-core Dice is 0.07. In fact, 10 test scans with large necrotic cores were under-segmented like this: the model found a median of only 31% of the core.

Third lesson: the confidence number from softmax is not calibrated. A model can be confident and still wrong; in this scan the uncertainty stayed low over most of the missed core. That is why in MedTwin a doctor reviews, edits and approves every result.

**[Ask the room]** Why might the model be bad at very large necrotic cores? (Only about 1 in 20 test scans has one, so the model probably saw few such examples in training.)

### 18. How to make it better (0:55)

How could we do better? These are great project ideas for you.

One, data augmentation: randomly flip, rotate and change the brightness of training scans, so the model sees more variety. MedTwin used none.
Two, better splits: split by patient and use cross-validation, which means training and testing several times on different splits and reporting the average and the spread.
Three, compare with nnU-Net, a self-configuring U-Net that is a standard strong baseline in medical segmentation.
Four, try Transformers such as Swin UNETR. Attention lets the model relate distant parts of the scan, while a CNN filter only looks locally.
Five, test-time augmentation and ensembles: average several predictions. This usually improves accuracy and gives better uncertainty.
Six, calibration: make sure that "70% confident" really means right 70% of the time, for example with temperature scaling.

### 19. Five things to remember (0:40)

To wrap up, five things to remember. [Read the five points briefly.]

If you remember only one thing: a good ML project is not just a high score. It is honest data splits, the right metric, looking at the failures, and keeping a human in the loop.

Thank you. Questions?

## Likely questions and short answers

| Question | Answer |
| --- | --- |
| Why 3D and not 2D slices? | A tumour continues across slices; a 3D filter sees the slices above and below. 2D models are cheaper and are a fair alternative to try. |
| Why not just use accuracy? | About 93% of the voxels are background, so a model that predicts "no tumour" everywhere looks 93% accurate. Dice only looks at the tumour. |
| What is a GPU and why do we need one? | A processor with thousands of small cores that do many multiply-and-add operations at once, which is exactly what convolution needs. |
| How long does one prediction take? | About 20–35 seconds per prepared scan on the 2 GB laptop GPU (from the project README; not a formal benchmark). |
| Why is the score only 0.78? | Small network (1.19 M parameters), no data augmentation, one split, and the metric averages the three separate labels, which is stricter than the BraTS region scores. |
| Can it replace a radiologist? | No. It is a research prototype, not approved for clinical use, and it makes mistakes (slide 17). A doctor reviews, edits and approves every result. |
| Where does the data come from? | The BraTS 2023 adult glioma challenge: public, expert-labelled research data. |
| What tools did you use? | Python, PyTorch and MONAI (a PyTorch library for medical imaging); the app uses FastAPI and Three.js for the 3D view. |
| What is an epoch? A batch? | One epoch is one pass over all training scans. A batch is how many scans are processed before each weight update; here it is 1. |

## Glossary (for students who ask afterwards)

- **Voxel:** a 3D pixel; here a 1 mm cube.
- **Channel:** one input image layer; MedTwin has 4 (T1, T1c, T2, FLAIR).
- **Supervised learning:** learning from examples that come with the correct answers (labels).
- **Convolution / filter:** a small grid of learned numbers slid over the image to detect patterns.
- **U-Net:** an encoder–decoder network with skip connections, built for segmentation.
- **Softmax / argmax:** turn scores into probabilities / pick the class with the highest probability.
- **Loss:** one number saying how wrong the prediction is; training makes it smaller.
- **Learning rate:** how big each weight update is.
- **Overfitting:** doing better on training data while not improving (or getting worse) on new data.
- **Dice / IoU:** overlap scores between the prediction and the expert label (1 = perfect).
- **ICC:** intraclass correlation; how well two sets of measurements (here, volumes) agree (1 = perfect).
- **Data leakage:** information from the test set reaching training, which makes scores look better than they are.
- **Calibration:** whether a model's confidence matches how often it is actually right.

## Where the numbers come from

Every number in the deck comes from the project, read without changing anything: the training notebook (via `research_paper/01_project_review.md` and `research_paper/analysis/results/training_history.csv`), the post-hoc analyses in `research_paper/analysis/results/` (data split audit, volume agreement, error analysis) and `research_paper/manuscript/figures/Fig4_case_statistics.json`. The 93% / 0.5% figures are for test scan 00449 (`assets/label_share.json`). The softmax numbers and the Dice toy example are made-up teaching examples and are labelled as such on the slides.

To rebuild the deck: run `presentation/source/make_assets.py` with the app's Python, then `node presentation/source/build_deck.js` (needs pptxgenjs, react, react-dom, react-icons and sharp).

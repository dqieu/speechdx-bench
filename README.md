# SpeechDx Leaderboard (interactive)

**Live:** https://dqieu.github.io/speechdx-bench/

Interactive leaderboard for the **SpeechDx** speech-health benchmark — external
audio/speech encoders ranked by **mean reciprocal rank (MRR)** across 27 clinical
tasks. Each cell is a frozen-encoder linear probe: **ROC-AUC** for classification
(higher = better, 0.5 = chance), **MAE** for regression (lower = better). Task columns are
border-coloured by the paper's speech-production categories (Affective / Cognitive
/ Motor / Respiratory); hover a task for its description, hover a model for its
checkpoint, click any column header to sort.

This is a **static site** — no build step. `index.html` + `style.css` + `app.js`,
with the data in `data.js`.

## Updating the data

`data.js` is generated from the (private) benchmark repo
[`chai-toronto/SpeechDx`](https://github.com/chai-toronto/SpeechDx), the source of
truth for the scores (`leaderboard.csv` on `main`):

```bash
# in the SpeechDx checkout:
python scripts/build_site_data.py        # writes docs/data.js
```

Then copy that `docs/data.js` here and push. The board mirrors `leaderboard.csv`
on `chai-toronto/SpeechDx@main` (`scripts/leaderboard.py --no-merge --mrr --drop ...`):
the 12 published external encoders, re-ranked among themselves, with the
from-scratch and LLM columns dropped.

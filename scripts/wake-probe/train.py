"""Trains the 'Hey Lampas' network of scripts/wake-probe/detector.mjs, on the features probe.mjs's prepare step wrote.

Run by `node scripts/wake-probe/probe.mjs train` with the scratch folder's venv (PyTorch for the CPU; see README.md):

    python train.py SCRATCH REPO

It reads SCRATCH/feat (network frames: 40 log-mel bands every 20 ms, made by detector.mjs, so training and scoring
share one front end), trains, mines hard negatives from the training speech, and writes SCRATCH/model-trained.json:
the layers as detector.mjs reads them (float32, little-endian, base64), with the date and the commit that trained it.
The threshold is set later, by probe.mjs's calibrate step, on other speech. One process, at most 4 threads.
"""

import base64
import datetime
import json
import os
import subprocess
import sys
import time

import numpy as np
import torch
from torch import nn

torch.set_num_threads(4)
torch.manual_seed(5)
WINDOW = 80  # network frames: 1.6 s; read from feat/meta.json
BANDS = 40
STEP = 2  # network frames between windows when listening: 40 ms
MINE_STEP = 3  # network frames between the windows scored when mining: 60 ms (neighbours are near copies)
SCALE = 5.0
EPOCHS = 24
MINE_AT = (8, 13, 18)
RANDOM_PER_EPOCH = 100_000
HARD_PER_ROUND = 25_000


class Net(nn.Module):
    """Three 1-D convolutions over time (the bands are the channels), then two dense layers."""

    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv1d(BANDS, 48, 5, stride=2)  # 80 -> 38
        self.c2 = nn.Conv1d(48, 48, 3, stride=2)  # 38 -> 18
        self.c3 = nn.Conv1d(48, 48, 3)  # 18 -> 16
        length = ((WINDOW - 5) // 2 + 1 - 3) // 2 + 1 - 2
        self.d1 = nn.Linear(48 * length, 32)
        self.d2 = nn.Linear(32, 1)
        self.drop = nn.Dropout(0.2)

    def forward(self, x):
        x = torch.relu(self.c1(x))
        x = torch.relu(self.c2(x))
        x = torch.relu(self.c3(x))
        x = self.drop(x.flatten(1))
        x = torch.relu(self.d1(x))
        return self.d2(x).squeeze(1)


def prepare_input(w):
    """Windows (N, WINDOW, BANDS) frame-major to the network's input: mean off, scaled, channel-major."""
    w = w - w.mean(dim=(1, 2), keepdim=True)
    return (w / SCALE).transpose(1, 2).contiguous()


def augment(w, gen):
    """A random tilt across the bands (a microphone's colour), and a few bands or frames masked to the window's mean."""
    n = w.shape[0]
    tilt = (torch.rand(n, 1, 1, generator=gen) - 0.5) * 1.5
    w = w + tilt * torch.linspace(-1, 1, BANDS).view(1, 1, BANDS)
    mean = w.mean(dim=(1, 2), keepdim=True)
    for _ in range(1):
        f0 = torch.randint(0, BANDS - 4, (n,), generator=gen)
        fw = torch.randint(0, 5, (n,), generator=gen)
        bands = torch.arange(BANDS).view(1, BANDS)
        fmask = (bands >= f0.view(-1, 1)) & (bands < (f0 + fw).view(-1, 1))
        t0 = torch.randint(0, WINDOW - 6, (n,), generator=gen)
        tw = torch.randint(0, 7, (n,), generator=gen)
        frames = torch.arange(WINDOW).view(1, WINDOW)
        tmask = (frames >= t0.view(-1, 1)) & (frames < (t0 + tw).view(-1, 1))
        keep = torch.rand(n, generator=gen) < 0.5
        mask = (fmask.view(n, 1, BANDS) | tmask.view(n, WINDOW, 1)) & keep.view(n, 1, 1)
        w = torch.where(mask, mean.expand_as(w), w)
    return w


def load(path, rows):
    data = np.fromfile(path, dtype=np.float32)
    return torch.from_numpy(data.reshape(-1, rows, BANDS))


def stream_windows(stream, starts):
    idx = torch.as_tensor(starts).view(-1, 1) + torch.arange(WINDOW).view(1, -1)
    return stream[idx]


def mine(net, stream, at_least):
    """Scores of every window of the training speech (one per MINE_STEP), and the starts of those at or over at_least."""
    net.eval()
    starts = torch.arange(0, stream.shape[0] - WINDOW + 1, MINE_STEP)
    found = []
    over_half = 0
    with torch.no_grad():
        for s in range(0, len(starts), 16384):
            chunk = starts[s : s + 16384]
            p = torch.sigmoid(net(prepare_input(stream_windows(stream, chunk))))
            over_half += int((p >= 0.5).sum())
            keep = p >= at_least
            found.append(torch.stack([chunk[keep].float(), p[keep]], 1))
    net.train()
    found = torch.cat(found)
    return found[found[:, 1].argsort(descending=True)], over_half, len(starts)


def b64(t):
    return base64.b64encode(t.detach().numpy().astype("<f4").tobytes()).decode("ascii")


def main(scratch, repo, smoke=False):
    global EPOCHS, MINE_AT, RANDOM_PER_EPOCH
    if smoke:  # a quick check of the whole path on a slice of the data: 2 epochs, one mining round
        EPOCHS, MINE_AT, RANDOM_PER_EPOCH = 2, (2,), 5_000
    t0 = time.time()
    feat = os.path.join(scratch, "feat")
    global WINDOW
    with open(os.path.join(feat, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    WINDOW = meta["window"]
    assert meta["bands"] == BANDS
    pos = load(os.path.join(feat, "pos.f32"), WINDOW)
    neg = load(os.path.join(feat, "negfixed.f32"), WINDOW)
    stream = torch.from_numpy(np.fromfile(os.path.join(feat, "stream.f32"), dtype=np.float32).reshape(-1, BANDS))
    if smoke:
        pos, neg, stream = pos[:2000], neg[:2000], stream[:1_000_000]
    hours = stream.shape[0] * 0.02 / 3600
    print(f"train: {len(pos)} positive windows, {len(neg)} fixed negative windows, {hours:.1f} h of negative stream", flush=True)
    gen = torch.Generator().manual_seed(7)
    net = Net()
    params = sum(p.numel() for p in net.parameters())
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    batches_per_epoch = (len(pos) + len(neg) + RANDOM_PER_EPOCH + 3 * HARD_PER_ROUND) // 256 + 1
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=EPOCHS * batches_per_epoch + 10, pct_start=0.1)
    hard = torch.empty(0, dtype=torch.long)
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")
    log = []
    for epoch in range(1, EPOCHS + 1):
        if epoch in MINE_AT:
            found, over_half, total = mine(net, stream, 0.05)
            new = found[:HARD_PER_ROUND, 0].long()
            hard = torch.unique(torch.cat([hard, new]))
            line = f"train: mined at epoch {epoch}: {over_half} of {total} training-speech windows scored 0.5 or more ({over_half / hours:.0f} an hour); {len(new)} added, {len(hard)} hard negatives in all"
            print(line, flush=True)
            log.append(line)
        rand = torch.randint(0, stream.shape[0] - WINDOW, (RANDOM_PER_EPOCH,), generator=gen)
        starts = torch.cat([rand, hard])
        n_pos, n_neg, n_stream = len(pos), len(neg), len(starts)
        order = torch.randperm(n_pos + n_neg + n_stream, generator=gen)
        total_loss = 0.0
        seen = 0
        for b in range(0, len(order), 256):
            ix = order[b : b + 256]
            parts, labels = [], []
            p_ix = ix[ix < n_pos]
            n_ix = ix[(ix >= n_pos) & (ix < n_pos + n_neg)] - n_pos
            s_ix = ix[ix >= n_pos + n_neg] - n_pos - n_neg
            if len(p_ix):
                parts.append(pos[p_ix])
                labels.append(torch.ones(len(p_ix)))
            if len(n_ix):
                parts.append(neg[n_ix])
                labels.append(torch.zeros(len(n_ix)))
            if len(s_ix):
                parts.append(stream_windows(stream, starts[s_ix]))
                labels.append(torch.zeros(len(s_ix)))
            x = prepare_input(augment(torch.cat(parts), gen))
            y = torch.cat(labels)
            weight = torch.where(y > 0, torch.tensor(3.0), torch.tensor(1.0))
            loss = (loss_fn(net(x), y) * weight).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total_loss += loss.item() * len(ix)
            seen += len(ix)
        net.eval()
        with torch.no_grad():
            pp = torch.cat([torch.sigmoid(net(prepare_input(pos[i : i + 8192]))) for i in range(0, len(pos), 8192)])
            pn = torch.cat([torch.sigmoid(net(prepare_input(neg[i : i + 8192]))) for i in range(0, len(neg), 8192)])
        net.train()
        line = f"train: epoch {epoch}/{EPOCHS} loss {total_loss / seen:.4f}; positives at 0.5 or more {float((pp >= 0.5).float().mean()):.3f}, fixed negatives under 0.5 {float((pn < 0.5).float().mean()):.3f} ({time.time() - t0:.0f} s)"
        print(line, flush=True)
        log.append(line)
    found, over_half, total = mine(net, stream, 0.5)
    line = f"train: at the end, {over_half} of {total} training-speech windows scored 0.5 or more ({over_half / hours:.1f} an hour)"
    print(line, flush=True)
    log.append(line)
    net.eval()
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain", "scripts/wake-probe"], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    layers = []
    for conv in (net.c1, net.c2, net.c3):
        layers.append({"type": "conv1d", "in": conv.in_channels, "out": conv.out_channels, "kernel": conv.kernel_size[0], "stride": conv.stride[0], "weights": b64(conv.weight), "bias": b64(conv.bias)})
        layers.append({"type": "relu"})
    layers.append({"type": "dense", "in": net.d1.in_features, "out": net.d1.out_features, "weights": b64(net.d1.weight), "bias": b64(net.d1.bias)})
    layers.append({"type": "relu"})
    layers.append({"type": "dense", "in": net.d2.in_features, "out": net.d2.out_features, "weights": b64(net.d2.weight), "bias": b64(net.d2.bias)})
    layers.append({"type": "sigmoid"})
    # a few windows and PyTorch's scores of them: probe.mjs's calibrate checks detector.mjs gives the same
    check = torch.cat([pos[:3], neg[:3]])
    with torch.no_grad():
        check_p = torch.sigmoid(net(prepare_input(check))).tolist()
    model = {
        "check": {"windows": b64(check), "scores": check_p},
        "trained": {
            "date": datetime.date.today().isoformat(),
            "commit": commit,
            "uncommittedChanges": dirty != "",
            "by": "scripts/wake-probe/train.py, run by scripts/wake-probe/probe.mjs train",
            "parameters": params,
            "epochs": EPOCHS,
            "seconds": round(time.time() - t0),
            "data": meta["summary"],
            "log": log,
        },
        "window": WINDOW,
        "step": STEP,
        "scale": SCALE,
        "layers": layers,
    }
    with open(os.path.join(scratch, "model-smoke.json" if smoke else "model-trained.json"), "w", encoding="utf-8") as f:
        json.dump(model, f)
    print(f"train: {params} weights written to the scratch folder's {'model-smoke.json' if smoke else 'model-trained.json'}; took {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], "--smoke" in sys.argv[3:])

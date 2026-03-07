"""
Generate ClinicalKB Study app icon: stylized raccoon with stethoscope.
Flat, minimal design that works at small sizes.
"""
from PIL import Image, ImageDraw
import math


def draw_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512

    # Background - rounded square (like iOS icons)
    bg_r = int(90 * s)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=bg_r, fill=(26, 26, 46))

    cx = size // 2
    cy = int(240 * s)

    # ===== RACCOON - big, simple, cute =====

    # Ears - simple triangles poking up
    ear_w = int(55 * s)
    ear_h = int(70 * s)
    # Left ear
    lx = int(155 * s)
    ly = int(115 * s)
    d.polygon([(lx, ly + ear_h), (lx + ear_w // 2, ly), (lx + ear_w, ly + ear_h)],
              fill=(100, 100, 115))
    # Left ear inner
    d.polygon([(lx + int(12*s), ly + ear_h - int(8*s)),
               (lx + ear_w // 2, ly + int(15*s)),
               (lx + ear_w - int(12*s), ly + ear_h - int(8*s))],
              fill=(200, 140, 150))
    # Right ear
    rx = int(302 * s)
    d.polygon([(rx, ly + ear_h), (rx + ear_w // 2, ly), (rx + ear_w, ly + ear_h)],
              fill=(100, 100, 115))
    # Right ear inner
    d.polygon([(rx + int(12*s), ly + ear_h - int(8*s)),
               (rx + ear_w // 2, ly + int(15*s)),
               (rx + ear_w - int(12*s), ly + ear_h - int(8*s))],
              fill=(200, 140, 150))

    # Head - big circle, fills most of the icon
    head_r = int(130 * s)
    d.ellipse([cx - head_r, cy - head_r, cx + head_r, cy + head_r],
              fill=(140, 140, 155))

    # Raccoon mask - the signature dark band across the eyes
    mask_h = int(52 * s)
    mask_top = cy - int(30 * s)
    d.rounded_rectangle([cx - head_r + int(10*s), mask_top,
                         cx + head_r - int(10*s), mask_top + mask_h],
                        radius=int(20*s), fill=(50, 50, 65))

    # White forehead stripe
    stripe_w = int(28 * s)
    d.rounded_rectangle([cx - stripe_w//2, cy - head_r + int(15*s),
                         cx + stripe_w//2, mask_top + mask_h - int(5*s)],
                        radius=int(10*s), fill=(190, 190, 200))

    # Eyes - big, round, expressive
    eye_r = int(22 * s)
    eye_y = cy - int(8 * s)
    eye_lx = cx - int(52 * s)
    eye_rx = cx + int(52 * s)

    # White of eyes
    d.ellipse([eye_lx - eye_r, eye_y - eye_r, eye_lx + eye_r, eye_y + eye_r],
              fill=(255, 255, 255))
    d.ellipse([eye_rx - eye_r, eye_y - eye_r, eye_rx + eye_r, eye_y + eye_r],
              fill=(255, 255, 255))

    # Pupils - shifted right and up for that saucy side-eye
    pupil_r = int(14 * s)
    px_off = int(5 * s)  # looking to the right
    py_off = int(-2 * s)  # looking slightly up
    d.ellipse([eye_lx + px_off - pupil_r, eye_y + py_off - pupil_r,
               eye_lx + px_off + pupil_r, eye_y + py_off + pupil_r],
              fill=(30, 30, 45))
    d.ellipse([eye_rx + px_off - pupil_r, eye_y + py_off - pupil_r,
               eye_rx + px_off + pupil_r, eye_y + py_off + pupil_r],
              fill=(30, 30, 45))

    # Eye shine
    shine_r = int(5 * s)
    sh_off_x = int(2 * s)
    sh_off_y = int(-4 * s)
    d.ellipse([eye_lx + px_off + sh_off_x - shine_r, eye_y + py_off + sh_off_y - shine_r,
               eye_lx + px_off + sh_off_x + shine_r, eye_y + py_off + sh_off_y + shine_r],
              fill=(255, 255, 255))
    d.ellipse([eye_rx + px_off + sh_off_x - shine_r, eye_y + py_off + sh_off_y - shine_r,
               eye_rx + px_off + sh_off_x + shine_r, eye_y + py_off + sh_off_y + shine_r],
              fill=(255, 255, 255))

    # One raised eyebrow (left side - the saucy one)
    brow_y = eye_y - eye_r - int(8 * s)
    brow_w = int(28 * s)
    brow_thick = max(2, int(4 * s))
    # Left brow - raised and angled
    d.line([(eye_lx - brow_w//2 - int(3*s), brow_y + int(5*s)),
            (eye_lx + brow_w//2 + int(3*s), brow_y - int(5*s))],
           fill=(200, 200, 215), width=brow_thick)
    # Right brow - flat
    d.line([(eye_rx - brow_w//2, brow_y),
            (eye_rx + brow_w//2, brow_y)],
           fill=(200, 200, 215), width=brow_thick)

    # Muzzle - lighter area below
    muzzle_w = int(60 * s)
    muzzle_h = int(45 * s)
    muzzle_y = cy + int(30 * s)
    d.ellipse([cx - muzzle_w, muzzle_y - muzzle_h//2,
               cx + muzzle_w, muzzle_y + muzzle_h],
              fill=(200, 200, 210))

    # Nose - simple dark oval
    nose_w = int(14 * s)
    nose_h = int(10 * s)
    nose_y = cy + int(32 * s)
    d.ellipse([cx - nose_w, nose_y - nose_h, cx + nose_w, nose_y + nose_h],
              fill=(50, 50, 60))
    # Nose shine
    d.ellipse([cx - int(6*s), nose_y - int(6*s), cx + int(2*s), nose_y - int(1*s)],
              fill=(80, 80, 90))

    # Mouth - smirk!
    mouth_y = nose_y + int(14 * s)
    # Left side of mouth - slight curve
    d.arc([cx - int(20*s), mouth_y - int(8*s), cx + int(5*s), mouth_y + int(12*s)],
          0, 150, fill=(70, 70, 80), width=max(2, int(3*s)))
    # Right side - bigger curve up for the smirk
    d.arc([cx - int(5*s), mouth_y - int(14*s), cx + int(35*s), mouth_y + int(8*s)],
          30, 160, fill=(70, 70, 80), width=max(2, int(3*s)))

    # ===== STETHOSCOPE =====
    steth = (96, 165, 250)  # Bright blue
    steth_metal = (200, 210, 225)
    tw = max(2, int(5 * s))  # tube width

    # Tubing draped around neck/shoulders
    # Left side - comes from behind left ear area, curves down
    tube_pts_l = []
    for i in range(20):
        t = i / 19
        # Bezier-ish curve from upper left to lower center-left
        x = int((110 + t * 100) * s)
        y = int((200 + t * 220 + math.sin(t * 1.5) * 30) * s)
        tube_pts_l.append((x, y))
    for i in range(len(tube_pts_l) - 1):
        d.line([tube_pts_l[i], tube_pts_l[i+1]], fill=steth, width=tw)

    # Right side
    tube_pts_r = []
    for i in range(20):
        t = i / 19
        x = int((402 - t * 100) * s)
        y = int((200 + t * 220 + math.sin(t * 1.5) * 30) * s)
        tube_pts_r.append((x, y))
    for i in range(len(tube_pts_r) - 1):
        d.line([tube_pts_r[i], tube_pts_r[i+1]], fill=steth, width=tw)

    # Tubes meet at bottom center - Y junction
    meet_x = cx
    meet_y = int(430 * s)
    # Connect left tube to center
    d.line([tube_pts_l[-1], (meet_x - int(10*s), meet_y - int(10*s))],
           fill=steth, width=tw)
    # Connect right tube to center
    d.line([tube_pts_r[-1], (meet_x + int(10*s), meet_y - int(10*s))],
           fill=steth, width=tw)
    # Short tube down to chest piece
    d.line([(meet_x, meet_y - int(10*s)), (meet_x, meet_y + int(15*s))],
           fill=steth, width=tw)

    # Chest piece (diaphragm) - clean circle
    bell_y = meet_y + int(20 * s)
    bell_r = int(18 * s)
    d.ellipse([meet_x - bell_r, bell_y - bell_r, meet_x + bell_r, bell_y + bell_r],
              fill=steth_metal)
    # Inner ring
    inner_r = int(13 * s)
    d.ellipse([meet_x - inner_r, bell_y - inner_r, meet_x + inner_r, bell_y + inner_r],
              fill=(170, 180, 195))
    # Center dot
    dot_r = int(4 * s)
    d.ellipse([meet_x - dot_r, bell_y - dot_r, meet_x + dot_r, bell_y + dot_r],
              fill=steth_metal)

    # Earpieces at top - small metal bits near ears
    ep_r = int(6 * s)
    d.ellipse([int(110*s) - ep_r, int(195*s) - ep_r,
               int(110*s) + ep_r, int(195*s) + ep_r], fill=steth_metal)
    d.ellipse([int(402*s) - ep_r, int(195*s) - ep_r,
               int(402*s) + ep_r, int(195*s) + ep_r], fill=steth_metal)

    return img


for icon_size in [192, 512]:
    icon = draw_icon(icon_size)
    path = f"C:/Users/stace/spaceport/ClinicalKB-Study/app/icon-{icon_size}.png"
    icon.save(path, 'PNG')
    print(f"Saved {icon_size}x{icon_size}")

print("Done!")

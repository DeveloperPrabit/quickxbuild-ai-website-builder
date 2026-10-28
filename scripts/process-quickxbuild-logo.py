from PIL import Image

src = r"C:\Users\prabitt\Desktop\quickxbuild\apps\web\public\quickxbuild-logo-src.png"
out_light = r"C:\Users\prabitt\Desktop\quickxbuild\apps\web\public\quickxbuild-logo.png"
out_dark = r"C:\Users\prabitt\Desktop\quickxbuild\apps\web\public\quickxbuild-logo-dark.png"

img = Image.open(src).convert("RGBA")
w, h = img.size
pixels = img.load()

light = Image.new("RGBA", (w, h), (0, 0, 0, 0))
dark = Image.new("RGBA", (w, h), (0, 0, 0, 0))
lp, dp = light.load(), dark.load()


def bg_keep_alpha(r, g, b, a):
    if a < 8:
        return 0
    mx = max(r, g, b)
    mn = min(r, g, b)
    sat = mx - mn
    brightness = (r + g + b) / 3.0
    if brightness >= 198 and sat <= 45:
        return 0
    if brightness >= 170 and sat <= 25:
        return int(255 * max(0.0, 1.0 - (brightness - 170) / 45.0))
    if brightness >= 155 and sat <= 14:
        return 0
    aa = a
    if brightness > 145 and sat < 28:
        aa = int(a * max(0.0, (175 - brightness) / 30.0))
    return aa


def is_wordmark_ink(r, g, b):
    """Dark navy wordmark (quick/build), not the bright cyan brand x/icon."""
    brightness = (r + g + b) / 3.0
    sat = max(r, g, b) - min(r, g, b)
    # bright cyan / royal facets stay as-is
    if brightness >= 90 and b >= r + 15 and b >= g + 5 and sat >= 35:
        return False
    if brightness >= 130 and sat >= 45:
        return False
    return brightness < 145


for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        aa = bg_keep_alpha(r, g, b, a)
        if aa < 10:
            continue
        lp[x, y] = (r, g, b, aa)
        if is_wordmark_ink(r, g, b):
            dp[x, y] = (248, 250, 255, aa)
        else:
            dp[x, y] = (r, g, b, aa)


def trim(im):
    bbox = im.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    pad = 6
    return im.crop(
        (max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad))
    )


light = trim(light)
dark = trim(dark)
light.save(out_light, "PNG", optimize=True)
dark.save(out_dark, "PNG", optimize=True)
print("ok", light.size, dark.size)
# sample a mid-right pixel likely on wordmark for dark
found = False
for y in range(dark.height // 3, 2 * dark.height // 3):
    for x in range(dark.width // 2, dark.width):
        p = dark.getpixel((x, y))
        if p[3] > 200:
            print("dark sample", x, y, p)
            found = True
            break
    if found:
        break

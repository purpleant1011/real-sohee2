"""PWA 아이콘/스플래시 생성기 (결정적 출력). 사용: python3 scripts/pwa/generate-pwa-assets.py
원본: public/brand/sohee-logo-mark-v1.png (전면 보라 배경 + 중앙 얼굴).
- maskable: 배경 전면 채움, 얼굴을 안전영역(중앙 80% 원) 안에 축소 배치
- any: 둥근 사각형(투명 모서리)
- apple-touch-icon: 불투명 전면 (iOS가 자체 마스크, 투명은 검정이 되므로)
- splash: 라이트 배경 #f7f6f2 + 중앙 마크 (iOS apple-touch-startup-image)
"""
from PIL import Image, ImageDraw
import numpy as np, os
SRC = 'public/brand/sohee-logo-mark-v1.png'
src = Image.open(SRC).convert('RGB')

def padded(size, face_ratio):
    """edge-replicate로 배경을 확장해 얼굴을 face_ratio 비율로 축소한 정사각 이미지."""
    inner = int(size * face_ratio)
    face = src.resize((inner, inner), Image.LANCZOS)
    pad = (size - inner) // 2
    arr = np.pad(np.asarray(face), ((pad, size - inner - pad), (pad, size - inner - pad), (0, 0)), mode='edge')
    return Image.fromarray(arr)

def rounded(img, radius_ratio=0.22):
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=int(img.width * radius_ratio), fill=255)
    out = img.convert('RGBA'); out.putalpha(m); return out

os.makedirs('public/icons', exist_ok=True)
for s in (192, 512):
    rounded(padded(s, 0.94)).save(f'public/icons/sohee-{s}.png', optimize=True)
    padded(s, 0.74).save(f'public/icons/sohee-maskable-{s}.png', optimize=True)
padded(180, 0.86).save('public/icons/apple-touch-icon.png', optimize=True)

# iOS splash: (css w, css h, dpr)
DEVICES = [(430,932,3),(428,926,3),(414,896,3),(414,896,2),(393,852,3),(390,844,3),(375,812,3),(375,667,2),(320,568,2),(820,1180,2),(834,1194,2),(1024,1366,2)]
BG = (247, 246, 242)
os.makedirs('public/splash', exist_ok=True)
for w, h, d in DEVICES:
    W, H = w * d, h * d
    img = Image.new('RGB', (W, H), BG)
    mark = int(min(W, H) * 0.26)
    ic = rounded(padded(mark, 0.94), 0.24)
    img.paste(ic, ((W - mark) // 2, (H - mark) // 2 - int(H * 0.03)), ic)
    img.save(f'public/splash/splash-{W}x{H}.png', optimize=True)
print('ok')

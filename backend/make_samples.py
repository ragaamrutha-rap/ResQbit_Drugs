from PIL import Image, ImageDraw

def make_sample(name, test_color, ref_color=(128, 128, 128), bg=(240, 240, 240)):
    img = Image.new('RGB', (400, 300), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([40, 120, 110, 180], fill=ref_color)
    d.rectangle([230, 120, 300, 180], fill=test_color)
    img.save(name)

make_sample('sample_positive.jpg', (200, 30, 90))
make_sample('sample_negative.jpg', (60, 180, 80))
make_sample('sample_inconclusive.jpg', (200, 200, 190))
make_sample('sample_positive_warm.jpg', (230, 40, 80), ref_color=(150, 128, 100))
print('samples created')
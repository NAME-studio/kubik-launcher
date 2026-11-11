'use strict';

(() => {
  const SkinRender = {};

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось загрузить изображение скина'));
      img.src = src;
    });
  }

  function normalize(img) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    if (img.height <= 32) {
      const copy = (sx, sy, sw, sh, dx, dy, flip) => {
        const tmp = document.createElement('canvas');
        tmp.width = sw;
        tmp.height = sh;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.save();
        if (flip) {
          ctx.translate(dx + sw, dy);
          ctx.scale(-1, 1);
          ctx.drawImage(tmp, 0, 0);
        } else {
          ctx.drawImage(tmp, dx, dy);
        }
        ctx.restore();
      };
      copy(0, 16, 16, 16, 16, 48, true);
      copy(40, 16, 16, 16, 32, 48, true);
    }
    return canvas;
  }

  function textureOf(image) {
    if (image instanceof HTMLCanvasElement) return image;
    if (image instanceof ImageData) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').putImageData(image, 0, 0);
      return normalize(canvas);
    }
    return normalize(image);
  }

  const FRONT = {
    head: [8, 8, 8, 8],
    body: [20, 20, 8, 12],
    rightArm: [44, 20, 4, 12],
    leftArm: [36, 52, 4, 12],
    rightLeg: [4, 20, 4, 12],
    leftLeg: [20, 52, 4, 12],
  };

  const FRONT_OVERLAY = {
    head: [40, 8, 8, 8],
    body: [20, 36, 8, 12],
    rightArm: [44, 36, 4, 12],
    leftArm: [52, 52, 4, 12],
    rightLeg: [4, 36, 4, 12],
    leftLeg: [4, 52, 4, 12],
  };

  const BACK = {
    head: [24, 8, 8, 8],
    body: [32, 20, 8, 12],
    rightArm: [52, 20, 4, 12],
    leftArm: [44, 52, 4, 12],
    rightLeg: [12, 20, 4, 12],
    leftLeg: [28, 52, 4, 12],
  };

  const BACK_OVERLAY = {
    head: [56, 8, 8, 8],
    body: [32, 36, 8, 12],
    rightArm: [52, 36, 4, 12],
    leftArm: [60, 52, 4, 12],
    rightLeg: [12, 36, 4, 12],
    leftLeg: [12, 52, 4, 12],
  };

  SkinRender.drawCharacter = (canvas, image, options = {}) => {
    const texture = textureOf(image);
    const model = options.model === 'slim' ? 'slim' : 'classic';
    const armW = model === 'slim' ? 3 : 4;
    const scale = options.scale || 8;
    const view = options.view === 'back' ? 'back' : 'front';
    const overlay = options.overlay !== false;
    const totalW = armW * 2 + 8;
    const totalH = 32;
    const ctx = canvas.getContext('2d');

    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const faces = view === 'back' ? BACK : FRONT;
    const overlays = view === 'back' ? BACK_OVERLAY : FRONT_OVERLAY;

    const part = (src, bx, by, w, h) => {
      if (!src) return;
      ctx.drawImage(texture, src[0], src[1], w, h, bx * scale, by * scale, w * scale, h * scale);
    };

    const headX = armW;
    part(faces.head, headX, 0, 8, 8);
    part(faces.body, headX, 8, 8, 12);

    if (view === 'back') {
      part(faces.leftArm, 0, 8, armW, 12);
      part(faces.rightArm, headX + 8, 8, armW, 12);
    } else {
      part(faces.rightArm, 0, 8, armW, 12);
      part(faces.leftArm, headX + 8, 8, armW, 12);
    }

    part(faces.rightLeg, headX, 20, 4, 12);
    part(faces.leftLeg, headX + 4, 20, 4, 12);

    if (overlay) {
      const overlayPart = (src, bx, by, w, h) => {
        if (!src) return;
        ctx.drawImage(texture, src[0], src[1], w, h, bx * scale, by * scale, w * scale, h * scale);
      };
      overlayPart(overlays.head, headX, 0, 8, 8);
      overlayPart(overlays.body, headX, 8, 8, 12);
      if (view === 'back') {
        overlayPart(overlays.leftArm, 0, 8, armW, 12);
        overlayPart(overlays.rightArm, headX + 8, 8, armW, 12);
      } else {
        overlayPart(overlays.rightArm, 0, 8, armW, 12);
        overlayPart(overlays.leftArm, headX + 8, 8, armW, 12);
      }
      overlayPart(overlays.rightLeg, headX, 20, 4, 12);
      overlayPart(overlays.leftLeg, headX + 4, 20, 4, 12);
    }

    return canvas;
  };

  SkinRender.headAvatar = (image, size = 64) => {
    const texture = textureOf(image);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(texture, 8, 8, 8, 8, 0, 0, size, size);
    ctx.drawImage(texture, 40, 8, 8, 8, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  };

  SkinRender.loadImage = loadImage;
  SkinRender.normalize = normalize;
  SkinRender.textureOf = textureOf;

  window.SkinRender = SkinRender;
})();

'use strict';

(() => {
  const BOXES = [
    {
      name: 'head',
      box: [-4, 4, 8, 16, -4, 4],
      uv: { front: [8, 8], back: [24, 8], left: [16, 8], right: [0, 8], top: [8, 0], bottom: [16, 0] },
      uv2: { front: [40, 8], back: [56, 8], left: [48, 8], right: [32, 8], top: [40, 0], bottom: [48, 0] },
    },
    {
      name: 'body',
      box: [-4, 4, -4, 8, -2, 2],
      uv: { front: [20, 20], back: [32, 20], left: [28, 20], right: [16, 20], top: [20, 16], bottom: [28, 16] },
      uv2: { front: [20, 36], back: [32, 36], left: [28, 36], right: [16, 36], top: [20, 32], bottom: [28, 32] },
    },
    {
      name: 'rightArm',
      box: [-8, -4, -4, 8, -2, 2],
      arm: 'right',
      uv: { front: [44, 20], back: [52, 20], left: [48, 20], right: [40, 20], top: [44, 16], bottom: [48, 16] },
      uv2: { front: [44, 36], back: [52, 36], left: [48, 36], right: [40, 36], top: [44, 32], bottom: [48, 32] },
    },
    {
      name: 'leftArm',
      box: [4, 8, -4, 8, -2, 2],
      arm: 'left',
      uv: { front: [36, 52], back: [44, 52], left: [40, 52], right: [32, 52], top: [36, 48], bottom: [40, 48] },
      uv2: { front: [52, 52], back: [60, 52], left: [56, 52], right: [48, 52], top: [52, 48], bottom: [56, 48] },
    },
    {
      name: 'rightLeg',
      box: [-4, 0, -16, -4, -2, 2],
      uv: { front: [4, 20], back: [12, 20], left: [8, 20], right: [0, 20], top: [4, 16], bottom: [8, 16] },
      uv2: { front: [4, 36], back: [12, 36], left: [8, 36], right: [0, 36], top: [4, 32], bottom: [8, 32] },
    },
    {
      name: 'leftLeg',
      box: [0, 4, -16, -4, -2, 2],
      uv: { front: [20, 52], back: [28, 52], left: [24, 52], right: [16, 52], top: [20, 48], bottom: [24, 48] },
      uv2: { front: [4, 52], back: [12, 52], left: [8, 52], right: [0, 52], top: [4, 48], bottom: [8, 48] },
    },
  ];

  function slimBoxes() {
    return BOXES.map((part) => {
      if (!part.arm) return part;
      const [x0, x1, y0, y1, z0, z1] = part.box;
      const box = part.arm === 'right' ? [x0 + 1, x0 + 4, y0, y1, z0, z1] : [x0, x0 + 3, y0, y1, z0, z1];
      return { ...part, box };
    });
  }

  const SLIM_BOXES = slimBoxes();

  const VERTEX_SHADER = `
    attribute vec3 aPos;
    attribute vec2 aUv;
    uniform mat4 uMvp;
    varying vec2 vUv;
    void main() {
      vUv = aUv / 64.0;
      gl_Position = uMvp * vec4(aPos, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform float uAlpha;
    void main() {
      vec4 color = texture2D(uTex, vUv);
      if (color.a < 0.04) discard;
      gl_FragColor = vec4(color.rgb, color.a * uAlpha);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Ошибка шейдера');
    }
    return shader;
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
        out[column * 4 + row] = sum;
      }
    }
    return out;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function rotationY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]);
  }

  function rotationX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]);
  }

  function translation(x, y, z) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  }

  function scaling(value) {
    return new Float32Array([value, 0, 0, 0, 0, value, 0, 0, 0, 0, value, 0, 0, 0, 0, 1]);
  }

  function uvRect(uv, uw, uh) {
    return [
      [uv[0], uv[1] + uh],
      [uv[0] + uw, uv[1] + uh],
      [uv[0] + uw, uv[1]],
      [uv[0], uv[1]],
    ];
  }

  const FACES = [
    {
      key: 'front',
      corners: (b) => [
        [b[0], b[2], b[5]],
        [b[1], b[2], b[5]],
        [b[1], b[3], b[5]],
        [b[0], b[3], b[5]],
      ],
      uvs: uvRect,
      size: (w, h, d) => [w, h],
    },
    {
      key: 'back',
      corners: (b) => [
        [b[1], b[2], b[4]],
        [b[0], b[2], b[4]],
        [b[0], b[3], b[4]],
        [b[1], b[3], b[4]],
      ],
      uvs: uvRect,
      size: (w, h, d) => [w, h],
    },
    {
      key: 'right',
      corners: (b) => [
        [b[1], b[2], b[5]],
        [b[1], b[2], b[4]],
        [b[1], b[3], b[4]],
        [b[1], b[3], b[5]],
      ],
      uvs: uvRect,
      size: (w, h, d) => [d, h],
    },
    {
      key: 'left',
      corners: (b) => [
        [b[0], b[2], b[4]],
        [b[0], b[2], b[5]],
        [b[0], b[3], b[5]],
        [b[0], b[3], b[4]],
      ],
      uvs: uvRect,
      size: (w, h, d) => [d, h],
    },
    {
      key: 'top',
      corners: (b) => [
        [b[0], b[3], b[5]],
        [b[1], b[3], b[5]],
        [b[1], b[3], b[4]],
        [b[0], b[3], b[4]],
      ],
      uvs: uvRect,
      size: (w, h, d) => [w, d],
    },
    {
      key: 'bottom',
      corners: (b) => [
        [b[0], b[2], b[4]],
        [b[1], b[2], b[4]],
        [b[1], b[2], b[5]],
        [b[0], b[2], b[5]],
      ],
      uvs: uvRect,
      size: (w, h, d) => [w, d],
    },
  ];

  function buildMesh(gl, boxes, layer, inflate) {
    const vertices = [];
    const indices = [];
    let offset = 0;
    for (const part of boxes) {
      const b = part.box;
      const w = b[1] - b[0];
      const h = b[3] - b[2];
      const d = b[5] - b[4];
      const uvMap = layer === 1 ? part.uv2 : part.uv;
      const bb = b.map((value, index) => (index % 2 === 0 ? value - inflate : value + inflate));
      for (const face of FACES) {
        if (!uvMap[face.key]) continue;
        const corners = face.corners(bb);
        const side = face.key === 'right' || face.key === 'left';
        const flat = face.key === 'top' || face.key === 'bottom';
        const coords = uvRect(uvMap[face.key], side ? d : w, flat ? d : h);
        for (let i = 0; i < 4; i += 1) {
          vertices.push(corners[i][0], corners[i][1], corners[i][2], coords[i][0], coords[i][1]);
        }
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
        offset += 4;
      }
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    return { vbo, ibo, count: indices.length, stride: 5 * 4 };
  }

  class Viewer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
      this.model = options.model === 'slim' ? 'slim' : 'classic';
      this.yaw = typeof options.yaw === 'number' ? options.yaw : 0.55;
      this.pitch = typeof options.pitch === 'number' ? options.pitch : 0.1;
      this.zoom = 1;
      this.autoRotate = options.autoRotate !== false;
      this.texture = null;
      this.destroyed = false;
      this.frame = null;
      this.last = 0;
      this.dragging = false;
      this.lastX = 0;
      this.lastY = 0;
      this.onModeChange = options.onModeChange || (() => {});

      if (!this.gl) throw new Error('WebGL недоступен');
      this.setup();
      this.bind();
      if (options.texture) this.setTexture(options.texture);
      this.loop = this.loop.bind(this);
      this.frame = requestAnimationFrame(this.loop);
    }

    setup() {
      const gl = this.gl;
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Ошибка программы');
      }
      this.program = program;
      this.aPos = gl.getAttribLocation(program, 'aPos');
      this.aUv = gl.getAttribLocation(program, 'aUv');
      this.uMvp = gl.getUniformLocation(program, 'uMvp');
      this.uAlpha = gl.getUniformLocation(program, 'uAlpha');
      this.uTex = gl.getUniformLocation(program, 'uTex');

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);

      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

      this.baseClassic = buildMesh(gl, BOXES, 0, 0);
      this.overlayClassic = buildMesh(gl, BOXES, 1, 0.25);
      this.baseSlim = buildMesh(gl, SLIM_BOXES, 0, 0);
      this.overlaySlim = buildMesh(gl, SLIM_BOXES, 1, 0.25);
    }

    bind() {
      const canvas = this.canvas;
      const down = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        this.dragging = true;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.autoRotate = false;
        this.onModeChange();
        if (canvas.setPointerCapture && event.pointerId !== undefined) {
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            /* ignore */
          }
        }
        canvas.classList.add('grabbing');
      };
      const move = (event) => {
        if (!this.dragging) return;
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.yaw += dx * 0.012;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dy * 0.009));
        this.render();
      };
      const up = (event) => {
        this.dragging = false;
        canvas.classList.remove('grabbing');
        if (canvas.releasePointerCapture && event.pointerId !== undefined) {
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch {
            /* ignore */
          }
        }
      };
      const wheel = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.zoom = Math.max(0.55, Math.min(2.4, this.zoom - event.deltaY * 0.0012));
        this.render();
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('pointerleave', up);
      canvas.addEventListener('wheel', wheel, { passive: false });
      canvas.addEventListener('dblclick', () => this.reset());
      this.handlers = { down, move, up, wheel };
    }

    setTexture(image) {
      if (!image || !window.SkinRender) return this;
      const canvas = window.SkinRender.textureOf(image);
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      this.texture = canvas;
      this.render();
      return this;
    }

    setModel(model) {
      this.model = model === 'slim' ? 'slim' : 'classic';
      this.render();
      return this;
    }

    setAutoRotate(value) {
      this.autoRotate = Boolean(value);
      this.onModeChange();
      return this;
    }

    setAngles(yaw, pitch) {
      this.yaw = yaw;
      this.pitch = pitch;
      this.render();
      return this;
    }

    reset() {
      this.yaw = 0.55;
      this.pitch = 0.1;
      this.zoom = 1;
      this.render();
    }

    loop(time) {
      if (this.destroyed) return;
      if (this.autoRotate && !this.dragging) {
        const delta = this.last ? Math.min(64, time - this.last) : 16;
        this.yaw += delta * 0.00032;
        this.render();
      }
      this.last = time;
      this.frame = requestAnimationFrame(this.loop);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round((rect.width || 320) * dpr));
      const height = Math.max(1, Math.round((rect.height || 380) * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.gl.viewport(0, 0, width, height);
      return { width, height };
    }

    render() {
      if (this.destroyed || !this.texture) return;
      const gl = this.gl;
      const { width, height } = this.resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);

      const aspect = width / height;
      const fov = (34 * Math.PI) / 180;
      const distance = 62 / this.zoom;
      const projection = perspective(fov, aspect, 1, 400);
      const view = translation(0, 0.5, -distance);
      let model = rotationX(this.pitch);
      model = multiply(rotationY(this.yaw), model);
      model = multiply(model, scaling(1));
      const mvp = multiply(projection, multiply(view, model));

      gl.uniformMatrix4fv(this.uMvp, false, mvp);
      gl.uniform1f(this.uAlpha, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(this.uTex, 0);

      const slim = this.model === 'slim';
      const layers = slim
        ? [this.baseSlim, this.overlaySlim]
        : [this.baseClassic, this.overlayClassic];

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      for (const mesh of layers) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, mesh.stride, 0);
        gl.enableVertexAttribArray(this.aUv);
        gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, mesh.stride, 12);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      }
    }

    destroy() {
      this.destroyed = true;
      if (this.frame) cancelAnimationFrame(this.frame);
      const canvas = this.canvas;
      if (this.handlers) {
        canvas.removeEventListener('pointerdown', this.handlers.down);
        canvas.removeEventListener('pointermove', this.handlers.move);
        canvas.removeEventListener('pointerup', this.handlers.up);
        canvas.removeEventListener('pointercancel', this.handlers.up);
        canvas.removeEventListener('pointerleave', this.handlers.up);
        canvas.removeEventListener('wheel', this.handlers.wheel);
      }
      const gl = this.gl;
      if (gl) {
        gl.deleteTexture(this.tex);
        for (const mesh of [this.baseClassic, this.overlayClassic, this.baseSlim, this.overlaySlim]) {
          if (mesh) {
            gl.deleteBuffer(mesh.vbo);
            gl.deleteBuffer(mesh.ibo);
          }
        }
        gl.deleteProgram(this.program);
      }
    }
  }

  window.Skin3D = {
    create(canvas, options) {
      return new Viewer(canvas, options);
    },
  };
})();

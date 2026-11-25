/**
 * A small WebGL pass for scenes rendered below the display's physical resolution.
 * It keeps bilinear colour reconstruction and applies a clipped, edge-directed local
 * contrast adjustment. Native-resolution frames bypass the pass completely.
 */
const MAX_OUTPUT_WIDTH = 3840;
const MAX_OUTPUT_HEIGHT = 2160;
const MAX_OUTPUT_PIXELS = MAX_OUTPUT_WIDTH * MAX_OUTPUT_HEIGHT;
const VALIDATION_INTERVAL_FRAMES = 120;

function vertexShader(highPrecision: boolean): string {
  return `
precision ${highPrecision ? 'highp' : 'mediump'} float;
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = (a_position + 1.0) * 0.5;
}
`;
}

function fragmentShader(highPrecision: boolean): string {
  return `
precision ${highPrecision ? 'highp' : 'mediump'} float;
uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_strength;
varying vec2 v_uv;

float luminance(vec3 colour) {
  return dot(colour, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 centre = texture2D(u_source, v_uv);
  vec3 left = texture2D(u_source, v_uv - vec2(u_texel.x, 0.0)).rgb;
  vec3 right = texture2D(u_source, v_uv + vec2(u_texel.x, 0.0)).rgb;
  vec3 above = texture2D(u_source, v_uv + vec2(0.0, u_texel.y)).rgb;
  vec3 below = texture2D(u_source, v_uv - vec2(0.0, u_texel.y)).rgb;

  float gx = abs(luminance(right) - luminance(left));
  float gy = abs(luminance(above) - luminance(below));
  float direction = gx / max(gx + gy, 0.0001);
  vec3 horizontalDetail = centre.rgb - (left + right) * 0.5;
  vec3 verticalDetail = centre.rgb - (above + below) * 0.5;
  vec3 detail = mix(verticalDetail, horizontalDetail, direction);
  float edge = clamp((gx + gy) * 3.0, 0.20, 1.0);

  vec3 low = min(centre.rgb, min(min(left, right), min(above, below)));
  vec3 high = max(centre.rgb, max(max(left, right), max(above, below)));
  vec3 reconstructed = clamp(centre.rgb + detail * u_strength * edge, low, high);
  gl_FragColor = vec4(reconstructed, centre.a);
}
`;
}

export interface SpatialViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}

/** Sharpen softly as the source needs more enlargement, and bypass almost-native sampling. */
export function spatialUpscaleStrength(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): number {
  if (sourceWidth < 1 || sourceHeight < 1 || targetWidth < 1 || targetHeight < 1) return 0;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 1.04) return 0;
  return Math.min(0.32, Math.max(0.055, (scale - 1) * 0.22));
}

export function canPresentInFullscreen(fullscreen: boolean, outputInsideFullscreen: boolean): boolean {
  return !fullscreen || outputInsideFullscreen;
}

export function activeFullscreenElement(doc: Document): Element | null {
  const legacy = (doc as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
  return doc.fullscreenElement ?? legacy ?? null;
}

export function shouldValidateSpatialOutput(
  validationRequired: boolean,
  framesSinceValidation: number,
  outputChanged: boolean,
): boolean {
  return validationRequired || outputChanged || framesSinceValidation >= VALIDATION_INTERVAL_FRAMES;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate a spatial upscale shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader) ?? 'shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(reason);
  }
  return shader;
}

function outputSize(width: number, height: number, limitWidth: number, limitHeight: number): [number, number] {
  const scale = Math.min(1, limitWidth / width, limitHeight / height, Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}

/**
 * Adds an optional same-origin WebGL presentation layer above Phaser's canvas.
 * The game canvas stays the pointer and keyboard target. Failure always exposes
 * that original canvas and lets the browser use its regular image interpolation.
 */
export class SpatialUpscaler {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext;
  private readonly source: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly buffer: WebGLBuffer;
  private readonly position: number;
  private readonly texelUniform: WebGLUniformLocation;
  private readonly strengthUniform: WebGLUniformLocation;
  private readonly maxWidth: number;
  private readonly maxHeight: number;
  private readonly initialOpacity: string;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private validatedWidth = 0;
  private validatedHeight = 0;
  private validatedTargetWidth = 0;
  private validatedTargetHeight = 0;
  private framesSinceValidation = 0;
  private validationRequired = true;
  private lastStrength = 0;
  private presenting = false;
  private layout = '';
  private disabled = false;
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.disable();
    this.disabled = true;
  };

  static create(source: HTMLCanvasElement): SpatialUpscaler | null {
    try {
      return new SpatialUpscaler(source);
    } catch {
      return null;
    }
  }

  private constructor(source: HTMLCanvasElement) {
    this.source = source;
    this.initialOpacity = source.style.opacity;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.spatialUpscale = 'inactive';
    this.canvas.style.cssText =
      'position:fixed;display:block;margin:0;padding:0;border:0;pointer-events:none;opacity:0;' +
      'z-index:1;outline:none;visibility:hidden;';
    const context = (this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    }) ?? this.canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!context) throw new Error('Secondary WebGL is unavailable');
    this.gl = context;

    const gl = this.gl;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const highPrecision = (precision?.precision ?? 0) > 0;
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader(highPrecision));
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader(highPrecision));
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate a spatial upscale program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const reason = gl.getProgramInfoLog(program) ?? 'program link failed';
      gl.deleteProgram(program);
      throw new Error(reason);
    }
    this.program = program;
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    if (!buffer || !texture) throw new Error('Unable to allocate spatial upscale resources');
    this.buffer = buffer;
    this.texture = texture;
    this.position = gl.getAttribLocation(program, 'a_position');
    const sourceUniform = gl.getUniformLocation(program, 'u_source');
    const texelUniform = gl.getUniformLocation(program, 'u_texel');
    const strengthUniform = gl.getUniformLocation(program, 'u_strength');
    if (this.position < 0 || !sourceUniform || !texelUniform || !strengthUniform)
      throw new Error('Spatial upscale uniforms are unavailable');
    this.texelUniform = texelUniform;
    this.strengthUniform = strengthUniform;

    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxWidth = Math.min(Number(viewport[0]), Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), MAX_OUTPUT_WIDTH);
    this.maxHeight = Math.min(Number(viewport[1]), Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), MAX_OUTPUT_HEIGHT);
    if (this.maxWidth < 2 || this.maxHeight < 2) throw new Error('Spatial upscale target is too small');

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.useProgram(program);
    gl.uniform1i(sourceUniform, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.position);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('The spatial upscale context is not ready');

    document.body.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  /** One pass per finished game frame. */
  render(viewport: SpatialViewport): void {
    if (this.disabled || this.gl.isContextLost()) {
      this.disable();
      return;
    }
    if (this.source.width < 320 || this.source.height < 180 || this.source.width === 1) {
      this.disable();
      return;
    }

    const fullscreen = activeFullscreenElement(document);
    if (
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      document.hidden ||
      !canPresentInFullscreen(!!fullscreen, !!fullscreen?.contains(this.canvas))
    ) {
      this.disable();
      return;
    }
    const [width, height] = outputSize(
      viewport.targetWidth,
      viewport.targetHeight,
      Math.min(this.maxWidth, this.source.width * 2),
      Math.min(this.maxHeight, this.source.height * 2),
    );
    this.setData('renderResolution', `${this.source.width}x${this.source.height}`);
    this.setData('displayResolution', `${width}x${height}`);
    this.setData('sourceScale', Math.min(width / this.source.width, height / this.source.height).toFixed(2));
    const strength = spatialUpscaleStrength(this.source.width, this.source.height, width, height);
    if (strength === 0) {
      this.disable();
      return;
    }

    const layout = `${viewport.left},${viewport.top},${viewport.width},${viewport.height},${width},${height}`;
    let targetChanged = false;
    if (layout !== this.layout) {
      this.canvas.style.left = `${viewport.left}px`;
      this.canvas.style.top = `${viewport.top}px`;
      this.canvas.style.width = `${viewport.width}px`;
      this.canvas.style.height = `${viewport.height}px`;
      if (this.canvas.width !== width) {
        this.canvas.width = width;
        targetChanged = true;
      }
      if (this.canvas.height !== height) {
        this.canvas.height = height;
        targetChanged = true;
      }
      this.layout = layout;
    }

    const gl = this.gl;
    try {
      if (
        targetChanged &&
        (gl.drawingBufferWidth !== this.canvas.width || gl.drawingBufferHeight !== this.canvas.height)
      )
        throw new Error('The spatial upscale framebuffer did not allocate at the requested size');
      if (targetChanged) gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const sourceChanged = this.source.width !== this.sourceWidth || this.source.height !== this.sourceHeight;
      if (sourceChanged) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
        this.sourceWidth = this.source.width;
        this.sourceHeight = this.source.height;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
      }
      if (sourceChanged) gl.uniform2f(this.texelUniform, 1 / this.sourceWidth, 1 / this.sourceHeight);
      if (strength !== this.lastStrength) {
        gl.uniform1f(this.strengthUniform, strength);
        this.lastStrength = strength;
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.framesSinceValidation++;
      if (
        shouldValidateSpatialOutput(
          this.validationRequired,
          this.framesSinceValidation,
          targetChanged ||
            sourceChanged ||
            this.validatedWidth !== this.sourceWidth ||
            this.validatedHeight !== this.sourceHeight ||
            this.validatedTargetWidth !== width ||
            this.validatedTargetHeight !== height,
        )
      ) {
        if (gl.drawingBufferWidth !== this.canvas.width || gl.drawingBufferHeight !== this.canvas.height)
          throw new Error('The spatial upscale framebuffer no longer matches its canvas');
        if (gl.getError() !== gl.NO_ERROR) throw new Error('The spatial upscale frame could not be presented');
        this.validatedWidth = this.sourceWidth;
        this.validatedHeight = this.sourceHeight;
        this.validatedTargetWidth = width;
        this.validatedTargetHeight = height;
        this.framesSinceValidation = 0;
        this.validationRequired = false;
      }
      if (gl.isContextLost()) {
        this.disable();
        return;
      }
      if (!this.presenting) {
        this.source.style.opacity = '0';
        this.canvas.style.visibility = 'visible';
        this.canvas.style.opacity = '1';
        this.source.dataset.spatialUpscale = 'active';
        this.canvas.dataset.sourceScale = this.source.dataset.sourceScale ?? '';
        this.presenting = true;
      }
    } catch {
      this.disable();
      this.disabled = true;
    }
  }

  /** Expose the untouched Phaser output while the page is hidden or the main context is rebuilding. */
  suspend(): void {
    this.disable();
  }

  destroy(): void {
    this.disable();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }

  private disable(): void {
    this.validationRequired = true;
    this.framesSinceValidation = 0;
    if (this.source.dataset.spatialUpscale !== 'inactive') this.source.dataset.spatialUpscale = 'inactive';
    if (!this.presenting) return;
    this.source.style.opacity = this.initialOpacity;
    this.canvas.style.opacity = '0';
    this.canvas.style.visibility = 'hidden';
    delete this.canvas.dataset.sourceScale;
    this.presenting = false;
  }

  private setData(key: 'renderResolution' | 'displayResolution' | 'sourceScale', value: string): void {
    if (this.source.dataset[key] !== value) this.source.dataset[key] = value;
  }
}

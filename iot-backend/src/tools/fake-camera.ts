// Fake vision stream for local tests: PNG frames over multipart HTTP, showing
// a figure crossing the zone inside a detection box (same scene as the MQTT data).
import { createServer, type Server } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { presenceAt, visitorAt } from './simulated-scene.js';

const WIDTH = 320;
const HEIGHT = 240;
const FRAME_MS = 200;
const BOUNDARY = 'frame';

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels: Buffer) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) pixels.copy(rows, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawFrame(t: number) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  const set = (x: number, y: number, [r, g, b]: number[]) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 3;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  };
  const rect = (x0: number, y0: number, w: number, h: number, color: number[]) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, color);
  };

  // Night scene: sky gradient, ground, fence posts.
  for (let y = 0; y < HEIGHT; y++) {
    const shade = y < 160 ? 30 + y / 4 : 45;
    rect(0, y, WIDTH, 1, y < 160 ? [shade * 0.6, shade * 0.7, shade] : [shade, shade, shade * 0.9]);
  }
  for (let x = 10; x < WIDTH; x += 40) rect(x, 120, 4, 50, [70, 70, 75]);
  rect(0, 130, WIDTH, 2, [70, 70, 75]);

  const progress = presenceAt(t);
  if (progress !== null) {
    const x = Math.round(20 + progress * (WIDTH - 80));
    const body = [190, 190, 200];
    rect(x + 12, 112, 16, 16, body); // head
    rect(x + 8, 130, 24, 40, body); // torso
    rect(x + 10, 170, 8, 30, body); // legs
    rect(x + 22, 170, 8, 30, body);
    // Detection box: green for a known face, red for an unknown one.
    const color = visitorAt(t) ? [60, 200, 90] : [230, 70, 60];
    const [bx, by, bw, bh] = [x, 104, 40, 100];
    rect(bx, by, bw, 2, color);
    rect(bx, by + bh - 2, bw, 2, color);
    rect(bx, by, 2, bh, color);
    rect(bx + bw - 2, by, 2, bh, color);
  }

  // Recording indicator, blinking once per second.
  if (Math.floor(t) % 2 === 0) rect(WIDTH - 18, 8, 10, 10, [220, 40, 40]);
  return encodePng(pixels);
}

export function startFakeCamera(port: number): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/stream.mjpg') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}` });
    const send = () => {
      const frame = drawFrame(Date.now() / 1000);
      response.write(`--${BOUNDARY}\r\nContent-Type: image/png\r\nContent-Length: ${frame.length}\r\n\r\n`);
      response.write(frame);
      response.write('\r\n');
    };
    send();
    const timer = setInterval(send, FRAME_MS);
    response.on('close', () => clearInterval(timer));
  });
  server.listen(port, '127.0.0.1');
  return server;
}

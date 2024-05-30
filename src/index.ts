import { Server } from 'ws';
import puppeteer, { Browser, Page } from 'puppeteer';
import { resolve } from 'path';
import { Turtle } from './turtle';
import World from './world';
import Queue from 'p-queue';
import http from 'http';
import fs from 'fs';
import path from 'path';

const wss = new Server({ port: 5757 });

let browser: Browser;
let page: Page;
let turtles: { [id: number]: Turtle } = {};

const world = new World();
const queue = new Queue({ concurrency: 1 });
const turtleAddQueue = new Queue({ concurrency: 1 });
turtleAddQueue.pause();

// Serve static files from the "frontend/out" directory
const serveFolder = resolve(process.cwd(), "frontend/out");
const server = http.createServer((req, res) => {
  const filePath = path.join(serveFolder, req.url === '/' ? 'index.html' : req.url || '');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(JSON.stringify(err));
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
});
//added this because 3000 is used by frontend
server.listen(3001, async () => {
  console.log('Server is listening on http://localhost:3000');

  // Launch Puppeteer
  browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1200,800']
  });
  page = await browser.newPage();

  // Load page
  await page.goto('http://localhost:3000');
  await page.setViewport({ width: 1200, height: 800 });

  // Expose functions to the browser context
  await page.exposeFunction('exec', async (index: number, func: string, ...args: any[]) => {
    if (typeof index === 'string') {
      [index, func, ...args] = JSON.parse(index).args;
    }
    return await queue.add(() => (turtles[index] as any)[func](...args));
  });

  await page.exposeFunction('refreshData', async () => {
    await page.evaluate(`if (window.setWorld) window.setWorld(${JSON.stringify(world.getAllBlocks())})`);
    await page.evaluate(`if (window.setTurtles) window.setTurtles(${serializeTurtles()})`);
  });

  world.on('update', async (world) => {
    await page.evaluate(`if (window.setWorld) window.setWorld(${JSON.stringify(world)})`);
  });

  turtleAddQueue.start();
});

wss.on('connection', async function connection(ws) {
  await turtleAddQueue.add(() => {
    let turtle = new Turtle(ws, world);
    turtle.on('init', async () => {
      turtles[turtle.id] = turtle;
      turtle.on('update', () => page.evaluate(`if (window.setTurtles) window.setTurtles(${serializeTurtles()})`));
      await page.evaluate(`if (window.setTurtles) window.setTurtles(${serializeTurtles()})`);
      await page.evaluate(`if (window.setWorld) window.setWorld(${JSON.stringify(world.getAllBlocks())})`);
      ws.on('close', async () => {
        delete turtles[turtle.id];
        await page.evaluate(`if (window.setTurtles) window.setTurtles(${serializeTurtles()})`);
      });
    });
  });
});

function serializeTurtles() {
  return JSON.stringify(Object.values(turtles));
}
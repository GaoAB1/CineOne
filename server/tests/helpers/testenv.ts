/**
 * 测试环境引导（必须在任何业务模块 import 之前引入本模块）。
 * ESM/CJS 均按 import 声明顺序求值，因此把本模块放在第一个 import
 * 即可保证业务代码读取配置前已注入独立的临时 DB 路径。
 *
 * 隔离策略：
 * - DB_DIR / DB_PATH 指向 server/.tmp-test-data/，不触碰 data/cineone.db 开发数据；
 * - 每个测试文件是独立子进程，用 pid 区分 DB 文件，避免并行竞争；
 * - JWT secret 也生成在临时目录内，测试后整体删除。
 */

import fs from 'node:fs';
import path from 'node:path';

export const TEST_DATA_DIR = path.resolve(__dirname, '..', '.tmp-test-data');

process.env.NODE_ENV = 'test';
process.env.DB_DIR = TEST_DATA_DIR;
process.env.DB_PATH = path.join(TEST_DATA_DIR, `test-${process.pid}.db`);

fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

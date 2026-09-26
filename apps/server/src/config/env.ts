/**
 * 环境变量读取与校验（启动时快速失败）
 * 管理端账号来自 env（阶段一单账号，见 apps/server/README.md 第 3 节）
 */

export interface Env {
  port: number
  databaseUrl: string
  jwtSecret: string
  adminUser: string
  adminPassword: string
  /** 失败截图落盘目录（execution-records 上传） */
  uploadDir: string
  nodeEnv: string
}

export function loadEnv(): Env {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret && nodeEnv === 'production') {
    throw new Error('JWT_SECRET is required in production')
  }
  const adminUser = process.env.ADMIN_USER ?? 'admin'
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin'
  if (nodeEnv === 'production' && adminPassword === 'admin') {
    throw new Error('ADMIN_PASSWORD must be changed in production')
  }

  return {
    port: Number(process.env.PORT ?? 3100),
    databaseUrl,
    jwtSecret: jwtSecret ?? 'dev-only-secret',
    adminUser,
    adminPassword,
    uploadDir: process.env.UPLOAD_DIR ?? 'data/screenshots',
    nodeEnv
  }
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 设置页面
 * @see 文档 2.3.1 设置
 *
 * 核心能力：
 * - Chrome 路径
 * - 并发上限
 * - 日志保留
 * - 代理配置
 * - 开机启动
 * - 托盘行为
 */
export default function SettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">设置</h1>
        <p className="text-muted-foreground">应用配置和偏好</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>通用设置</CardTitle>
          <CardDescription>基础配置项</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 4 待实现</p>
        </CardContent>
      </Card>
    </div>
  )
}

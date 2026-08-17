import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 执行监控页面
 * @see 文档 2.3.1 执行监控
 *
 * 核心能力（Phase 3）：
 * - 查看账号运行状态、当前步骤、进度
 * - 查看错误、截图
 * - 支持取消和重试
 */
export default function ExecutionPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">执行监控</h1>
        <p className="text-muted-foreground">实时监控任务执行状态</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>正在执行</CardTitle>
          <CardDescription>当前正在运行的任务</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 3 待实现</p>
        </CardContent>
      </Card>
    </div>
  )
}

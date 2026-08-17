import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 任务管理页面
 * @see 文档 2.3.1 任务管理
 *
 * 核心能力（Phase 2）：
 * - 创建任务
 * - 编辑参数
 * - 查看任务版本
 * - 启用/停用任务
 */
export default function TasksPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">任务管理</h1>
        <p className="text-muted-foreground">管理自动化任务和脚本</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>当前已配置的自动化任务</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 2 待实现</p>
        </CardContent>
      </Card>
    </div>
  )
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 账号管理页面
 * @see 文档 2.3.1 账号管理
 *
 * 核心能力（Phase 1）：
 * - 创建账号
 * - 启动/关闭 Profile
 * - 手动登录
 * - 检查登录态
 * - 删除账号
 */
export default function AccountsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">账号管理</h1>
        <p className="text-muted-foreground">管理淘宝直播中控台账号</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>账号列表</CardTitle>
          <CardDescription>当前已配置的淘宝账号</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 1 待实现</p>
        </CardContent>
      </Card>
    </div>
  )
}

# 数据查询语义说明（模板）

把这个文件复制成 `docs/SQL_SEMANTICS.md` 后按实际情况填写，服务会自动读取并放进模型的提示词。
没填的部分不要保留占位符——宁可删掉，也不要让模型读到 `TODO`。

## 一、表说明

| 表名 | 一句话说明 | 数据范围 | 备注 |
|---|---|---|---|
| `users` | 注册用户主表 | 全部注册用户 | 含已注销？ |
| `daily_usage` | 每日使用记录 | 每用户每天一行 | 无治疗记录的日期不出现 |

## 二、关键字段

| 表.字段 | 含义 | 取值 / 单位 | 注意 |
|---|---|---|---|
| `daily_usage.therapy_minutes` | 当日治疗时长 | 分钟 | 未治疗为 NULL 还是 0？ |
| `daily_usage.ahi` | 设备上报 AHI | 次/小时 | **不是**工程候选密度，不能混用 |
| `users.registered_at` | 注册时间 | UTC 还是 +08:00？ | 跨时区统计必须先转换 |

## 三、关联关系

- `daily_usage.user_id` → `users.user_id`
- 一个用户可能对应多台设备？如果是，说明怎么取"当前设备"

## 四、口径定义（必须写死，避免模型自己发挥）

- **活跃用户**：所选日期内存在有效使用记录的去重用户数
- **使用时长**：`therapy_minutes` 求和 ÷ 60，按 Asia/Shanghai 自然日
- **平均每日使用时间**：总分钟数 ÷ 活跃用户天数，不是除以注册用户数
- 跨午夜记录如何归属：
- 同一用户重叠区间是否合并：

## 五、必须排除的数据

- 测试账号（如 `user_id` 前缀 `TEST_`）
- 软删除标记：`is_deleted = 1`
- 异常记录（治疗时长 < 5 分钟且 AHI = 0）

## 六、示例（few-shot，最有效的一节）

写 3~5 组「问题 → 正确 SQL」：

**问题**：各设备型号有多少用户？
```sql
SELECT device_model, COUNT(DISTINCT user_id) AS users
FROM users
WHERE is_deleted = 0
GROUP BY device_model
ORDER BY users DESC
```

**问题**：最近 7 天每天有多少活跃用户？
```sql
SELECT record_date, COUNT(DISTINCT user_id) AS active_users
FROM daily_usage
WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  AND therapy_minutes >= 15
GROUP BY record_date
ORDER BY record_date
```

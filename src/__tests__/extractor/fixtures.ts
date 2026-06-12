// src/__tests__/extractor/fixtures.ts

/** 典型中文邮件测试集 */
export const GOLDEN_EMAILS = [
  {
    name: '领导分派任务 + 明确截止日',
    input: `王总：

请安排一下Q3的报表整理工作，下周五前交给我。
另外客户那边有个合同需要回复，时间比较紧，这周五之前搞定。

谢谢
李总`,
    expectTodos: 2,
    expectKeywords: ['Q3', '报表', '合同'],
  },
  {
    name: '委婉请求',
    input: `嗨，小明，

辛苦帮忙看一下昨天那个bug，测试那边报了两次了。
不着急，有空处理就行。

小红`,
    expectTodos: 1,
    expectKeywords: ['bug'],
  },
  {
    name: '纯通知 - 不应产生待办',
    input: `各位同事：

已收到大家的周报，汇总后发给领导了。
谢谢大家的配合！

行政部`,
    expectTodos: 0,
    expectKeywords: [],
  },
  {
    name: '多待办混合',
    input: `张经理：

关于新项目启动，有几点需要处理：
1. 尽快确认技术方案，最好这周内
2. 麻烦安排下团队kick-off meeting
3. 预算审批已经走完了，通知一下大家就行

另外上次的报销麻烦帮我催一下财务。

谢谢
刘总`,
    expectTodos: 3, // 1,2,4 是待办；3 是"通知一下"也可能是待办
    expectKeywords: ['技术方案', 'meeting', '报销'],
  },
  {
    name: '模糊截止表达',
    input: `王工：

项目进度有点滞后，节前需要完成第一阶段。
客户说月底前要看到演示版本。

老板`,
    expectTodos: 2,
    expectKeywords: ['节前', '月底'],
  },
]

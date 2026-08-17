const taskDefinitions = [
  ["daily-recruit-character", "每日自动抽角色", "daily", "每日", "每日抽取角色并预留资源阈值。"],
  ["daily-recruit-weapon", "自动抽武器", "daily", "每日", "武器抽取策略与次数限制。"],
  ["guild-sign-in", "公会签到", "social", "社交", "进入公会页面并完成签到。"],
  ["harvest", "收菜", "daily", "日常", "领取可收取的日常资源。"],
  ["mail-claim", "邮箱领取", "daily", "日常", "批量领取邮件附件。"],
  ["pass-claim", "通行证领取", "daily", "日常", "检查并领取通行证奖励。"],
  ["demon-challenge", "魔兽挑战", "battle", "战斗", "魔兽挑战入口、战斗和结果识别。"],
  ["event-battle", "活动战斗", "battle", "战斗", "活动关卡与次数控制。"],
  ["event-shop", "活动商店自动购买", "shop", "商店", "按优先级和资源上限购买。"],
  ["collectibles", "收集物吸取", "collection", "收集", "地图收集物识别与吸取。"],
  ["glutti-absorb", "葛罗提吸取", "collection", "收集", "葛罗提相关吸取流程。"],
  ["suppression", "压制", "battle", "战斗", "压制玩法入口和次数控制。"],
  ["rice-battle", "米饭战斗", "battle", "战斗", "米饭战斗与资源消耗控制。"],
  ["torch-battle", "火把战斗", "battle", "战斗", "火把战斗与资源消耗控制。"],
  ["hunting-ground", "狩猎场战斗", "battle", "战斗", "狩猎场战斗和结果识别。"],
  ["steal-money", "偷钱", "battle", "战斗", "偷钱流程与次数控制。"],
  ["weekly-map", "每周地图任务", "battle", "每周", "每周地图目标和完成状态追踪。"],
  ["pvp", "自动 PVP", "pvp", "竞技", "PVP 队伍策略与赛季次数控制。"],
  ["tavern-affinity", "酒馆亲密度", "social", "社交", "酒馆互动和亲密度进度。"],
  ["square-shop", "广场商品购买", "shop", "商店", "广场商品购买与资源阈值。"],
  ["goddess-statue", "女神像签到", "social", "社交", "女神像签到流程。"],
  ["daily-reward", "每日任务奖励", "daily", "日常", "每日任务奖励领取。"],
  ["weekly-reward", "每周任务奖励", "daily", "每周", "每周任务奖励领取。"]
].map(([id, name, category, group, description]) => ({
  id,
  name,
  category,
  group,
  description,
  status: "todo",
  resource: `resources/tasks/${id}.json`,
  logic: "TODO: 待采集游戏资源、截图、识别规则和具体流程。",
  retryLimit: 1,
  dependencies: []
}));

const taskDefinitionMap = new Map(taskDefinitions.map((definition) => [definition.id, definition]));

function getTaskDefinition(id) {
  return taskDefinitionMap.get(id);
}

function createDefaultPlan() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: ["mail-claim", "daily-reward", "guild-sign-in", "harvest", "event-shop", "rice-battle", "pvp"].map((id, index) => ({
      id: `${id}-${index + 1}`,
      definitionId: id,
      enabled: true,
      parameters: {},
      retryLimit: getTaskDefinition(id).retryLimit
    }))
  };
}

module.exports = { taskDefinitions, getTaskDefinition, createDefaultPlan };

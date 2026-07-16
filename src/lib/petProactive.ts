export function createProactivePetChatRequest(
  retainedRecordIds: string[],
  persona: string,
  customPrompt: string | null,
) {
  return {
    taskType: "pet_chat" as const,
    payload: {
      content: "请根据用户允许的上下文，用一句简短、不施压的方式主动问候或邀请交流。",
      retainedRecordIds,
      persona,
      customPrompt,
    },
  };
}

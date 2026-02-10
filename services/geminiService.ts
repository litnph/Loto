import { GoogleGenAI } from "@google/genai";

let genAI: GoogleGenAI | null = null;

try {
  // Safe check for process to prevent Vercel/browser runtime errors if process is not polyfilled
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
} catch (e) {
  console.error("Failed to initialize Gemini", e);
}

export const generateMCCommentary = async (number: number): Promise<string> => {
  if (!genAI) {
    return `Số ${number}!`;
  }

  try {
    const model = 'gemini-3-flash-preview';
    const prompt = `Viết một câu rao lô tô ngắn, vui nhộn, vần điệu bằng tiếng Việt cho con số ${number}. Chỉ trả về câu rao, không có giải thích. Ví dụ với số 1: "Gì đây gì đây, cây cột đèn là số 1".`;
    
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 } // Fast response needed
      }
    });

    return response.text?.trim() || `Số ${number}!`;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return `Con số... ${number}!`;
  }
};
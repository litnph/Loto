import { GoogleGenAI } from "@google/genai";

let genAI: GoogleGenAI | null = null;
let isQuotaExceeded = false;

try {
  // Safe check for process to prevent Vercel/browser runtime errors if process is not polyfilled
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
} catch (e) {
  console.error("Failed to initialize Gemini", e);
}

export const generateMCCommentary = async (number: number): Promise<string> => {
  if (!genAI || isQuotaExceeded) {
    return `Số ${number}!`;
  }

  try {
    const model = 'gemini-3-flash-preview';
    // Updated prompt to enforce the number is mentioned clearly at the end
    const prompt = `Viết một câu rao lô tô ngắn (lục bát hoặc vè), vui nhộn, vần điệu bằng tiếng Việt cho con số ${number}. Bắt buộc kết thúc câu bằng cụm từ "là số ${number}" hoặc "con số ${number}". Không thêm giải thích hay lời dẫn.`;
    
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 } // Fast response needed
      }
    });

    return response.text?.trim() || `Số ${number}!`;
  } catch (error: any) {
    // Handle Quota Exceeded gracefully
    if (error?.status === 429 || error?.code === 429 || error?.toString().includes('429') || error?.toString().includes('quota')) {
        console.warn("Gemini API Quota Exceeded. Disabling AI commentary for this session.");
        isQuotaExceeded = true;
    } else {
        console.error("Gemini API Error:", error);
    }
    return `Con số... ${number}!`;
  }
};
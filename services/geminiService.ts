import { GoogleGenAI, Type } from "@google/genai";
import { GeminiAnalysisResult } from "../types";
import { blobToBase64 } from "../utils/audioUtils";

export const analyzeAudioForHighlight = async (audioFile: File): Promise<GeminiAnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = await blobToBase64(audioFile);

  const systemInstruction = `
    Eres un experto editor de audio. Analiza el audio y encuentra el segmento más interesante de hasta 30 segundos.
    Responde estrictamente en formato JSON.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: audioFile.type || "audio/mp3",
              data: base64Data,
            },
          },
          {
            text: "Identify the best 30-second highlight segment from this audio.",
          },
        ],
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            start: { type: Type.NUMBER, description: "Start time in seconds" },
            end: { type: Type.NUMBER, description: "End time in seconds" },
            reason: { type: Type.STRING, description: "Reason for selection" }
          },
          required: ["start", "end"]
        }
      },
    });

    const result = JSON.parse(response.text || '{}');
    return result as GeminiAnalysisResult;
  } catch (error) {
    console.error("Gemini Error:", error);
    return { start: 0, end: 30, reason: "Error de análisis, usando inicio por defecto." };
  }
};
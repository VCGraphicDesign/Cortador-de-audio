import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

export class MobileFileService {
  
  // Guardar audio editado en el dispositivo
  static async saveAudioFile(blob: Blob, filename: string): Promise<string> {
    try {
      // Convertir blob a base64
      const base64Data = await this.blobToBase64(blob);
      
      // Guardar en el directorio de documentos
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Documents,
        recursive: false
      });
      
      return result.uri;
    } catch (error) {
      console.error('Error saving file:', error);
      throw error;
    }
  }
  
  // Compartir archivo de audio
  static async shareAudioFile(blob: Blob, filename: string): Promise<void> {
    try {
      const base64Data = await this.blobToBase64(blob);
      
      await Share.share({
        title: 'Audio editado',
        text: `Compartiendo ${filename}`,
        url: `data:audio/mpeg;base64,${base64Data}`
      });
    } catch (error) {
      console.error('Error sharing file:', error);
      throw error;
    }
  }
  
  // Convertir Blob a Base64
  private static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Quitar el prefijo "data:*/*;base64,"
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  // Verificar si estamos en un dispositivo móvil
  static isNative(): boolean {
    return Capacitor.getPlatform() !== 'web';
  }
}

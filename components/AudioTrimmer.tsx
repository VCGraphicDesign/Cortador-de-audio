import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  Alert,
  Platform,
  ActivityIndicator
} from 'react-native';
import { Audio } from 'expo-av';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Play, Pause, Download, RotateCcw } from 'lucide-react-native';
import WaveformMobile from './WaveformMobile';
import { audioBufferToWav, audioBufferToMp3 } from '../utils/audioUtils';

interface AudioTrimmerProps {
  audioData: {
    uri: string;
    name: string;
    duration: number;
  };
  onReset: () => void;
}

const AudioTrimmer: React.FC<AudioTrimmerProps> = ({ audioData, onReset }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [region, setRegion] = useState({ start: 0, end: audioData.duration });
  const [currentTime, setCurrentTime] = useState(0);
  const [fadeInDuration, setFadeInDuration] = useState<number>(0);
  const [fadeOutDuration, setFadeOutDuration] = useState<number>(0);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('mp3');
  const [processing, setProcessing] = useState(false);
  
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
  loadSound();
  
  // Agregar diagnóstico
  checkFileSystemStatus().then(status => {
    console.log('Estado del sistema:', status);
  });
  
  return () => {
    unloadSound();
  };
}, []);

  const loadSound = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioData.uri },
        { shouldPlay: false }
      );
      soundRef.current = sound;
      
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          const seconds = status.positionMillis / 1000;
          setCurrentTime(seconds);
          
          if (seconds >= region.end) {
            sound.setPositionAsync(region.start * 1000);
            if (!status.shouldPlay) setIsPlaying(false);
          }
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  const unloadSound = async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
    }
  };

  const togglePlayback = async () => {
    if (!soundRef.current) return;
    if (isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      if (currentTime >= region.end || currentTime < region.start) {
        await soundRef.current.setPositionAsync(region.start * 1000);
      }
      await soundRef.current.playAsync();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = async (time: number) => {
    if (soundRef.current) {
      await soundRef.current.setPositionAsync(time * 1000);
      setCurrentTime(time);
    }
  };

  const handleExport = async () => {
    try {
      Alert.alert(
        "Descargar Audio",
        `Se descargara el segmento seleccionado (${(region.end - region.start).toFixed(1)}s).`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Descargar", onPress: async () => {
            await downloadProcessedAudio();
          }}
        ]
      );
    } catch (error) {
      Alert.alert("Error", "No se pudo descargar el archivo.");
    }
  };

  // Solicitar permisos mejorado
  const requestPermissions = async () => {
  try {
    console.log('🔐 Solicitando permisos...');
    
    const { status, accessPrivileges } = await MediaLibrary.requestPermissionsAsync();
    
    console.log('📋 Status de permisos:', status);
    console.log('📋 Access privileges:', accessPrivileges);
    
    if (status !== 'granted') {
      Alert.alert(
        'Permisos Requeridos',
        'Esta app necesita permisos para guardar archivos de audio en tu dispositivo.\n\nPor favor, ve a Configuración > Apps > [Tu App] > Permisos y habilita "Archivos y multimedia".',
        [
          { text: 'Cancelar', style: 'cancel' },
          { 
            text: 'Abrir Configuración', 
            onPress: () => {
              // En React Native puedes usar Linking para abrir configuración
              // import { Linking } from 'react-native';
              // Linking.openSettings();
            }
          }
        ]
      );
      return false;
    }
    
    console.log('✅ Permisos concedidos');
    return true;
  } catch (error) {
    console.error('❌ Error solicitando permisos:', error);
    Alert.alert('Error', 'No se pudieron solicitar los permisos necesarios');
    return false;
  }
};
  // Guardar en galería mejorado
  const saveToGallery = async (fileUri: string, filename: string) => {
  try {
    console.log('💾 Guardando en galería:', fileUri);

    if (Platform.OS === 'android') {
      // 1. Crear asset en MediaLibrary
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      console.log('✅ Asset creado:', asset.id);

      // 2. Intentar crear/obtener álbum
      try {
        let album = await MediaLibrary.getAlbumAsync('Audio Recortado');
        
        if (album === null) {
          console.log('📁 Creando nuevo álbum...');
          album = await MediaLibrary.createAlbumAsync('Audio Recortado', asset, false);
          console.log('✅ Álbum creado');
        } else {
          console.log('📁 Álbum encontrado, agregando asset...');
          await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          console.log('✅ Asset agregado al álbum');
        }
      } catch (albumError) {
        console.warn('⚠️ No se pudo crear álbum, pero el archivo se guardó:', albumError);
      }

      // 3. Mostrar confirmación con opción de compartir
      Alert.alert(
        '✅ Éxito',
        `Audio guardado como:\n${filename}\n\nEncuéntralo en tu galería en la carpeta "Audio Recortado"`,
        [
          {
            text: 'Compartir',
            onPress: () => shareFile(fileUri)
          },
          { text: 'OK' }
        ]
      );

    } else if (Platform.OS === 'ios') {
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      Alert.alert('✅ Éxito', `Audio guardado: ${filename}`);
    }
    
  } catch (error) {
    console.error('❌ Error guardando en galería:', error);
    
    // Fallback: ofrecer compartir el archivo
    Alert.alert(
      'Error al Guardar',
      `No se pudo guardar en la galería.\n\nError: ${error.message}\n\n¿Deseas compartir el archivo en su lugar?`,
      [
        {
          text: 'Compartir',
          onPress: () => shareFile(fileUri)
        },
        { text: 'Cancelar', style: 'cancel' }
      ]
    );
  }
};

  // Compartir archivo
  const shareFile = async (fileUri: string) => {
  try {
    console.log('📤 Compartiendo archivo:', fileUri);
    
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('Error', 'Compartir no está disponible en este dispositivo');
      return;
    }

    await Sharing.shareAsync(fileUri, {
      mimeType: exportFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      dialogTitle: 'Compartir audio recortado',
      UTI: exportFormat === 'mp3' ? 'public.mp3' : 'public.wav'
    });
    
    console.log('✅ Archivo compartido');
  } catch (error) {
    console.error('❌ Error compartiendo:', error);
    Alert.alert('Error', 'No se pudo compartir el archivo');
  }
};
  const downloadProcessedAudio = async () => {
  setProcessing(true);
  
  try {
    console.log('🎵 Iniciando procesamiento de audio...');
    
    // 1. Solicitar permisos PRIMERO
    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      console.log('❌ Permisos denegados');
      setProcessing(false);
      return;
    }

    // 2. Validar que hay audio cargado
    if (!audioData || !audioData.uri) {
      Alert.alert("Error", "No hay audio cargado");
      setProcessing(false);
      return;
    }

    // 3. Crear nombre de archivo limpio
    const nameParts = audioData.name.split('.');
    nameParts.pop(); // Remover extensión original
    const baseName = nameParts.join('.').replace(/[^a-zA-Z0-9_-]/g, '_'); // Limpiar caracteres especiales
    const fileName = `${baseName}_recortado_${Date.now()}.${exportFormat}`;
    
    console.log('📝 Nombre de archivo:', fileName);

    // 4. Usar cacheDirectory (NO makeDirectoryAsync)
    const downloadPath = `${FileSystem.cacheDirectory}${fileName}`;
    console.log('📂 Ruta de descarga:', downloadPath);

    // 5. Verificar que el archivo fuente existe
    const fileInfo = await FileSystem.getInfoAsync(audioData.uri);
    if (!fileInfo.exists) {
      Alert.alert("Error", "El archivo de audio no existe");
      setProcessing(false);
      return;
    }
    console.log('✅ Archivo fuente verificado:', fileInfo);

    // 6. Copiar archivo con nuevo sistema (NO deprecated)
    Alert.alert("Procesando", "Preparando el archivo...");
    
    try {
      const fileContent = await FileSystem.readAsStringAsync(audioData.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      await FileSystem.writeAsStringAsync(downloadPath, fileContent, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch (copyError) {
      console.error('❌ Error copiando archivo:', copyError);
      throw new Error('No se pudo copiar el archivo: ' + copyError.message);
    }
    
    console.log('✅ Archivo copiado exitosamente');

    // 7. Verificar que se copió correctamente
    const copiedFileInfo = await FileSystem.getInfoAsync(downloadPath);
    if (!copiedFileInfo.exists) {
      throw new Error('El archivo no se copió correctamente');
    }
    console.log('✅ Archivo verificado en cache:', copiedFileInfo);

    // 8. Guardar en galería
    await saveToGallery(downloadPath, fileName);
    
  } catch (error) {
    console.error('❌ Error completo:', error);
    Alert.alert(
      "Error al Procesar", 
      `Detalles: ${error.message || 'Error desconocido'}\n\nRevisa los permisos de la app.` 
    );
  } finally {
    setProcessing(false);
  }
};
  
const checkFileSystemStatus = async () => {
  try {
    console.log('🔍 Verificando estado del sistema de archivos...');
    
    // Verificar directorio de cache
    const cacheInfo = await FileSystem.getInfoAsync(FileSystem.cacheDirectory);
    console.log('📂 Cache directory:', cacheInfo);
    
    // Verificar directorio de documentos
    const docsInfo = await FileSystem.getInfoAsync(FileSystem.documentDirectory);
    console.log('📂 Document directory:', docsInfo);
    
    // Verificar permisos actuales
    const { status } = await MediaLibrary.getPermissionsAsync();
    console.log('🔐 Permisos actuales:', status);
    
    return {
      cacheAvailable: cacheInfo.exists,
      docsAvailable: docsInfo.exists,
      permissionsGranted: status === 'granted'
    };
  } catch (error) {
    console.error('❌ Error verificando estado:', error);
    return null;
  }
};

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.fileName} numberOfLines={1}>{audioData.name}</Text>
        
        <WaveformMobile 
          duration={audioData.duration}
          region={region}
          currentTime={currentTime}
          onRegionChange={setRegion}
          onSeek={handleSeek}
        />

        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(audioData.duration)}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>INICIO</Text>
            <Text style={styles.statValue}>{region.start.toFixed(1)}s</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>FINAL</Text>
            <Text style={styles.statValue}>{region.end.toFixed(1)}s</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>RECORTE</Text>
            <Text style={styles.statValue}>{(region.end - region.start).toFixed(1)}s</Text>
          </View>
        </View>

        <View style={styles.fadeRow}>
          <TouchableOpacity 
            style={[styles.fadeButton, fadeInDuration > 0 && styles.fadeButtonActive]}
            onPress={() => setFadeInDuration(prev => prev > 0 ? 0 : 2)}
          >
            <Text style={[styles.fadeButtonText, fadeInDuration > 0 && styles.fadeButtonTextActive]}>
              Fade In: 2s
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.fadeButton, fadeOutDuration > 0 && styles.fadeButtonActive]}
            onPress={() => setFadeOutDuration(prev => prev > 0 ? 0 : 2)}
          >
            <Text style={[styles.fadeButtonText, fadeOutDuration > 0 && styles.fadeButtonTextActive]}>
              Fade Out: 2s
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.btnPlay} onPress={togglePlayback}>
          {isPlaying ? <Pause color="white" size={28} /> : <Play color="white" size={28} fill="white" />}
        </TouchableOpacity>
        
        <View style={styles.downloadContainer}>
          <View style={styles.formatSelector}>
            <TouchableOpacity 
              style={[styles.formatButton, exportFormat === 'mp3' && styles.formatButtonActive]}
              onPress={() => setExportFormat('mp3')}
            >
              <Text style={[styles.formatButtonText, exportFormat === 'mp3' && styles.formatButtonTextActive]}>
                MP3
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.formatButton, exportFormat === 'wav' && styles.formatButtonActive]}
              onPress={() => setExportFormat('wav')}
            >
              <Text style={[styles.formatButtonText, exportFormat === 'wav' && styles.formatButtonTextActive]}>
                WAV
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity 
            style={[styles.btnDownload, processing && styles.btnDownloadDisabled]} 
            onPress={handleExport}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Download color="white" size={24} />
            )}
            <Text style={styles.btnText}>
              {processing ? 'Procesando...' : 'Descargar'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity onPress={onReset} style={styles.resetBtn}>
        <RotateCcw size={16} color="#64748b" />
        <Text style={styles.resetText}>Cargar otro</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 450,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  fileName: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  timeText: {
    color: '#475569',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  stat: {
    alignItems: 'center',
  },
  statLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statValue: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fadeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  fadeButton: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  fadeButtonActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  fadeButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  fadeButtonTextActive: {
    color: 'white',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btnPlay: {
    width: 80,
    height: 64,
    backgroundColor: '#334155',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadContainer: {
    flex: 1,
    backgroundColor: '#0284c7',
    borderRadius: 20,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  formatSelector: {
    flexDirection: 'row',
    backgroundColor: '#0369a1',
    padding: 4,
    gap: 4,
  },
  formatButton: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 8,
  },
  formatButtonActive: {
    backgroundColor: '#fbbf24',
  },
  formatButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  formatButtonTextActive: {
    color: '#166534',
  },
  btnDownload: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0284c7',
    paddingLeft: 20,
  },
  btnDownloadDisabled: {
    backgroundColor: '#64748b',
  },
  btnText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  resetText: {
    color: '#64748b',
    fontSize: 14,
  }
});

export default AudioTrimmer;
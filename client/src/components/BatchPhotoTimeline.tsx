import React, { useEffect, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Camera as CameraIcon, SpinnerGap } from '@phosphor-icons/react';
import { BatchPhotoRow, getBatchPhotos, saveBatchPhoto } from '../lib/api';

export function BatchPhotoTimeline({ batchId }: { batchId: number | string }) {
  const [photos, setPhotos] = useState<BatchPhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPhotos();
  }, [batchId]);

  async function loadPhotos() {
    try {
      const data = await getBatchPhotos(batchId);
      setPhotos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCapture() {
    try {
      const image = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });

      if (image.base64String) {
        setSaving(true);
        // Prefix for the img tag
        const dataUrl = `data:image/${image.format};base64,${image.base64String}`;
        await saveBatchPhoto(batchId, dataUrl, '');
        await loadPhotos();
      }
    } catch (e) {
      console.error('Camera error', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lab-card overflow-hidden">
      <div className="p-4 border-b border-surface-border flex items-center justify-between">
        <h3 className="font-semibold text-surface-text">Photo Timeline</h3>
        <button
          onClick={handleCapture}
          disabled={saving}
          className="text-bio-green hover:text-bio-green/80 transition-colors disabled:opacity-50"
        >
          {saving ? <SpinnerGap size={20} className="animate-spin" /> : <CameraIcon size={20} />}
        </button>
      </div>
      <div className="p-4 space-y-4">
        {loading ? (
          <div className="text-surface-muted text-sm flex items-center justify-center py-4">
            <SpinnerGap size={20} className="animate-spin" />
          </div>
        ) : photos.length === 0 ? (
          <div className="text-surface-muted text-sm text-center py-4">
            No photos yet. Capture the first one!
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative group rounded-lg overflow-hidden border border-surface-border bg-surface-900 aspect-square">
                <img src={p.photo_data_b64} alt="Batch timeline" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1.5 backdrop-blur-sm">
                  <div className="text-[10px] text-white font-mono text-center">
                    {new Date(p.captured_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

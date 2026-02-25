/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, ChangeEvent } from 'react';
import { Download, Share2, Upload, ZoomIn, CreditCard, Loader2, ArrowLeft, Image as ImageIcon, Users, List, Link, Trash2 } from 'lucide-react';

interface ImageState {
  x: number;
  y: number;
  scale: number;
}

type ViewState = 'home' | 'create' | 'list' | 'participate';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [userImg, setUserImg] = useState<HTMLImageElement | null>(null);
  const [frameImg, setFrameImg] = useState<HTMLImageElement | null>(null);
  const [imgState, setImgState] = useState<ImageState>({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  
  // Navigation State
  const [currentView, setCurrentView] = useState<ViewState>('home');

  // Campaign States
  const [campaignName, setCampaignName] = useState('');
  const [campaignFrameBase64, setCampaignFrameBase64] = useState<string | null>(null);
  const [campaignsList, setCampaignsList] = useState<any[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);

  // Payment States
  const [isPaying, setIsPaying] = useState(false);

  const CANVAS_WIDTH = 1080;
  const CANVAS_HEIGHT = 1350;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment_status');
    const campId = params.get('campaign_id');
    const directCampId = params.get('c');

    if (status === 'approved' && campId) {
      // Fetch the newly created campaign and go to participate
      // We pass force_approve=true to optimistically approve it since we came from a successful redirect
      setIsLoadingCampaigns(true);
      fetch(`/api/campaigns/${campId}?force_approve=true`)
        .then(res => res.json())
        .then(data => {
          setIsLoadingCampaigns(false);
          if (data && data.frame_image) {
            setActiveCampaign(data);
            loadFrameImage(data.frame_image);
            setCurrentView('participate');
            // Clean URL
            window.history.replaceState({}, document.title, "/");
          } else {
            // If it fails, go to list
            alert("Não foi possível carregar a campanha. Verifique a lista.");
            fetchCampaigns();
            setCurrentView('list');
          }
        })
        .catch(err => {
          setIsLoadingCampaigns(false);
          console.error("Error loading campaign:", err);
          alert("Erro ao carregar a campanha. Verifique a lista.");
          fetchCampaigns();
          setCurrentView('list');
        });
    } else if (directCampId) {
      // Direct link to participate in a specific campaign
      setIsLoadingCampaigns(true);
      fetch(`/api/campaigns/${directCampId}`)
        .then(res => res.json())
        .then(data => {
          setIsLoadingCampaigns(false);
          if (data && data.frame_image) {
            setActiveCampaign(data);
            loadFrameImage(data.frame_image);
            setCurrentView('participate');
          } else {
            alert("Campanha não encontrada.");
            setCurrentView('home');
          }
        })
        .catch(err => {
          setIsLoadingCampaigns(false);
          console.error("Error loading direct campaign:", err);
          alert("Erro ao carregar a campanha.");
          setCurrentView('home');
        });
    }
  }, []);

  const loadFrameImage = (src: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    img.onload = () => setFrameImg(img);
  };

  // Draw loop
  useEffect(() => {
    if (currentView !== 'participate') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw User Image (Underneath)
    if (userImg) {
      const drawWidth = userImg.width * imgState.scale;
      const drawHeight = userImg.height * imgState.scale;
      
      ctx.save();
      ctx.translate(CANVAS_WIDTH / 2 + imgState.x, CANVAS_HEIGHT / 2 + imgState.y);
      ctx.drawImage(userImg, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    }

    // Draw Frame (On top)
    if (frameImg) {
      ctx.drawImage(frameImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 20;
      ctx.strokeRect(10, 10, CANVAS_WIDTH - 20, CANVAS_HEIGHT - 20);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(0,0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#666';
      ctx.font = '60px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Aguardando Moldura...', CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
    }
  }, [userImg, frameImg, imgState, currentView]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setUserImg(img);
        const scale = Math.max(CANVAS_WIDTH / img.width, CANVAS_HEIGHT / img.height);
        setImgState({ x: 0, y: 0, scale });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCustomFrameUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("A imagem da moldura é muito grande (máximo 2MB). Por favor, use uma imagem mais leve.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Redimensionar/Comprimir para garantir que caiba no limite da Vercel
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1080;
        const MAX_HEIGHT = 1350;
        
        canvas.width = MAX_WIDTH;
        canvas.height = MAX_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, MAX_WIDTH, MAX_HEIGHT);
          // Exportar como PNG (mantém transparência) mas com tamanho controlado
          const compressedBase64 = canvas.toDataURL('image/png');
          setCampaignFrameBase64(compressedBase64);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const createCampaign = async () => {
    if (!campaignName.trim()) return alert("Por favor, insira o nome da campanha.");
    if (!campaignFrameBase64) return alert("Por favor, envie a arte da moldura.");

    setIsPaying(true);
    try {
      // Check payload size (Vercel limit is 4.5MB)
      const payloadSize = JSON.stringify({ name: campaignName, frame_image: campaignFrameBase64 }).length;
      if (payloadSize > 4 * 1024 * 1024) {
        throw new Error("A imagem da moldura é muito grande. Por favor, use uma imagem menor que 3MB.");
      }

      const res = await fetch('/api/campaigns', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaignName, frame_image: campaignFrameBase64 })
      });
      
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        window.location.href = data.init_point;
      } else {
        const text = await res.text();
        console.error("Server returned non-JSON:", text);
        const errorSnippet = text.substring(0, 150).replace(/<[^>]*>?/gm, '');
        throw new Error(`O servidor retornou um erro (${res.status}). Detalhes: ${errorSnippet}... Verifique as variáveis de ambiente na Vercel.`);
      }
    } catch (err: any) {
      console.error("Payment error:", err);
      alert("Erro ao iniciar pagamento: " + err.message);
    } finally {
      setIsPaying(false);
    }
  };

  const fetchCampaigns = async () => {
    setIsLoadingCampaigns(true);
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      setCampaignsList(data);
    } catch (err) {
      console.error("Error fetching campaigns:", err);
    } finally {
      setIsLoadingCampaigns(false);
    }
  };

  const selectCampaign = async (id: string) => {
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      const data = await res.json();
      if (data && data.frame_image) {
        setActiveCampaign(data);
        loadFrameImage(data.frame_image);
        setCurrentView('participate');
      }
    } catch (err) {
      console.error("Error selecting campaign:", err);
      alert("Erro ao carregar a campanha.");
    }
  };

  const shareCampaignFromList = async (e: React.MouseEvent, camp: any) => {
    e.stopPropagation(); // Prevent opening the campaign
    
    const url = `${window.location.origin}/?c=${camp.id}`;
    const text = `Participe da campanha: ${camp.name}! Crie sua foto personalizada aqui:`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: camp.name,
          text: text,
          url: url
        });
      } catch (err) {
        console.error('Erro ao compartilhar link:', err);
      }
    } else {
      navigator.clipboard.writeText(`${text} ${url}`);
      alert('Link da campanha copiado para a área de transferência!');
    }
  };

  const deleteCampaign = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent opening the campaign
    
    const password = prompt("Digite a senha de administrador para excluir esta campanha:");
    if (!password) return;

    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        alert("Campanha excluída com sucesso!");
        fetchCampaigns(); // Refresh the list
      } else {
        alert(data.error || "Erro ao excluir campanha.");
      }
    } catch (err) {
      console.error("Error deleting campaign:", err);
      alert("Erro ao excluir a campanha.");
    }
  };

  const getEventPos = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (e.touches && e.touches[0]) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleStart = (e: any) => {
    setIsDragging(true);
    setLastPos(getEventPos(e));
  };

  const handleMove = (e: any) => {
    if (!isDragging || !userImg) return;
    const currentPos = getEventPos(e);
    const dx = currentPos.x - lastPos.x;
    const dy = currentPos.y - lastPos.y;

    setImgState(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy
    }));
    setLastPos(currentPos);
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    const name = activeCampaign?.name || 'campanha';
    link.download = `${name.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  };

  const [isProcessing, setIsProcessing] = useState(false);

  const handleSharePhoto = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    setIsProcessing(true);
    try {
      // 1. Converte o canvas para Blob (JPEG)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) throw new Error("Falha ao gerar imagem");

      // 2. Cria o arquivo real
      const file = new File([blob], 'minha-foto-campanha.jpg', { 
        type: 'image/jpeg',
        lastModified: Date.now()
      });

      // 3. Tenta o compartilhamento nativo PRIMEIRO
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          const isAndroid = /Android/i.test(navigator.userAgent);
          
          await navigator.share({
            title: 'Minha Foto',
            // No Android/WhatsApp, enviar texto junto com arquivo faz a imagem ser ignorada.
            // No iPhone funciona bem. Então removemos o texto se for Android.
            text: isAndroid ? undefined : 'Olha a foto que eu fiz!',
            files: [file]
          });
        } catch (shareErr: any) {
          // Se o erro não for cancelamento, tentamos o download como fallback
          if (shareErr.name !== 'AbortError') {
            console.error('Erro no compartilhamento nativo, tentando download:', shareErr);
            handleDownload();
          }
        }
      } else {
        // Se o navegador não suportar compartilhar arquivos, vai direto pro download
        handleDownload();
      }
    } catch (err: any) {
      console.error('Erro ao processar a imagem:', err);
      alert("Houve um erro ao gerar sua foto.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShareLink = async () => {
    if (!activeCampaign) return;
    
    const url = `${window.location.origin}/?c=${activeCampaign.id}`;
    const text = `Participe da campanha: ${activeCampaign.name}! Crie sua foto personalizada aqui:`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: activeCampaign.name,
          text: text,
          url: url
        });
      } catch (err) {
        console.error('Erro ao compartilhar link:', err);
      }
    } else {
      navigator.clipboard.writeText(`${text} ${url}`);
      alert('Link da campanha copiado para a área de transferência!');
    }
  };

  const renderHome = () => (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-md mx-auto space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">Campanha Digital</h1>
        <p className="text-gray-500">Crie ou participe de campanhas com fotos personalizadas.</p>
      </div>

      <button 
        onClick={() => setCurrentView('create')}
        className="w-full flex items-center justify-center gap-3 p-5 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all transform hover:scale-105 shadow-lg"
      >
        <ImageIcon size={24} />
        <span>CRIAR CAMPANHA</span>
      </button>

      <button 
        onClick={() => {
          fetchCampaigns();
          setCurrentView('list');
        }}
        className="w-full flex items-center justify-center gap-3 p-5 bg-white text-indigo-600 border-2 border-indigo-600 rounded-2xl font-bold hover:bg-indigo-50 transition-all transform hover:scale-105 shadow-sm"
      >
        <Users size={24} />
        <span>PARTICIPAR DA CAMPANHA</span>
      </button>
    </div>
  );

  const renderCreate = () => (
    <div className="flex flex-col items-center w-full max-w-md mx-auto flex-1 mt-8">
      <div className="w-full flex items-center mb-6">
        <button onClick={() => setCurrentView('home')} className="p-2 text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold text-gray-800 ml-2">Criar Campanha</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 w-full mb-6">
        <h3 className="font-bold text-lg mb-4 text-gray-800">Instruções</h3>
        <ul className="space-y-4 text-sm text-gray-600 mb-6">
          <li className="flex gap-3">
            <span className="font-bold text-indigo-600 bg-indigo-50 w-6 h-6 flex items-center justify-center rounded-full shrink-0">1</span>
            <span>A arte da sua moldura deve ter exatamente <strong>1080x1350 pixels</strong> (formato retrato).</span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-indigo-600 bg-indigo-50 w-6 h-6 flex items-center justify-center rounded-full shrink-0">2</span>
            <span>O fundo onde a foto do usuário vai aparecer deve ser <strong>transparente</strong> (formato PNG).</span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-indigo-600 bg-indigo-50 w-6 h-6 flex items-center justify-center rounded-full shrink-0">3</span>
            <span>Para liberar o envio da sua arte, é necessário realizar o pagamento de <strong>R$ 29,99</strong> via Mercado Pago.</span>
          </li>
        </ul>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome da Campanha</label>
            <input 
              type="text" 
              placeholder="Ex. Campanha do Deputado Fulano"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Arte da Moldura (PNG)</label>
            <label className="w-full flex items-center justify-center gap-2 p-4 bg-gray-100 text-gray-700 border-2 border-dashed border-gray-300 rounded-xl font-bold cursor-pointer hover:bg-gray-200 transition-colors">
              <Upload size={20} />
              <span>{campaignFrameBase64 ? 'ARTE SELECIONADA' : 'ENVIAR ARTE'}</span>
              <input type="file" accept="image/png" onChange={handleCustomFrameUpload} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      <button 
        onClick={createCampaign} 
        disabled={isPaying || !campaignName || !campaignFrameBase64}
        className="w-full flex items-center justify-center gap-2 p-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-lg"
      >
        {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard size={20} />}
        <span>SALVAR E LIBERAR ENVIO (R$ 29,99)</span>
      </button>
    </div>
  );

  const renderList = () => (
    <div className="flex flex-col items-center w-full max-w-md mx-auto flex-1 mt-8">
      <div className="w-full flex items-center mb-6">
        <button onClick={() => setCurrentView('home')} className="p-2 text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold text-gray-800 ml-2">Escolha uma Campanha</h2>
      </div>

      {isLoadingCampaigns ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="animate-spin text-indigo-600" size={32} />
        </div>
      ) : campaignsList.length === 0 ? (
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border border-gray-100 w-full">
          <p className="text-gray-500">Nenhuma campanha encontrada.</p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          {campaignsList.map(camp => (
            <div
              key={camp.id}
              className="w-full flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all group cursor-pointer"
              onClick={() => selectCampaign(camp.id)}
            >
              <div className="flex items-center gap-4 flex-1">
                <div className="bg-indigo-50 p-3 rounded-xl text-indigo-600">
                  <List size={24} />
                </div>
                <span className="font-bold text-gray-800 text-lg truncate">{camp.name}</span>
              </div>
              
              <div className="flex items-center gap-2 ml-4">
                <button 
                  onClick={(e) => shareCampaignFromList(e, camp)}
                  className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Compartilhar"
                >
                  <Share2 size={20} />
                </button>
                <button 
                  onClick={(e) => deleteCampaign(e, camp.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Excluir"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderParticipate = () => (
    <div className="flex flex-col items-center w-full">
      <header className="mb-6 w-full flex items-center justify-between max-w-[500px]">
        <button onClick={() => setCurrentView('list')} className="p-2 text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div className="text-center flex-1 mr-10">
          <h1 className="text-xl font-bold text-gray-800 uppercase tracking-wider">
            {activeCampaign?.name || 'Campanha'}
          </h1>
          <p className="text-xs text-gray-500">Personalize sua foto de perfil</p>
        </div>
      </header>

      <div className="editor-container mt-0">
        <div className="relative overflow-hidden rounded-xl shadow-inner bg-gray-100 aspect-[4/5]">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            className="cursor-move"
          />
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-4">
            <ZoomIn className="text-gray-400 w-5 h-5" />
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.01"
              value={imgState.scale}
              onChange={(e) => setImgState(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
              className="flex-1"
            />
          </div>

          <div className="controls">
            <label className="upload-label flex items-center justify-center gap-2">
              <Upload size={20} />
              <span>FOTO</span>
              <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            </label>
            
            <button 
              onClick={handleSharePhoto} 
              disabled={isProcessing}
              className={`flex items-center justify-center gap-2 ${isProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isProcessing ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Share2 size={20} />
              )}
              <span>{isProcessing ? 'PROCESSANDO...' : 'COMPARTILHAR FOTO'}</span>
            </button>
          </div>

          <button 
            onClick={handleDownload} 
            className="w-full mt-2 bg-gray-800 hover:bg-black flex items-center justify-center gap-2 text-white p-4 rounded-xl font-bold transition-colors"
          >
            <Download size={20} />
            <span>BAIXAR ALTA RESOLUÇÃO</span>
          </button>

          <button 
            onClick={handleShareLink} 
            className="w-full mt-2 bg-green-600 hover:bg-green-700 flex items-center justify-center gap-2 text-white p-4 rounded-xl font-bold transition-colors shadow-lg"
          >
            <Link size={20} />
            <span>COMPARTILHAR CAMPANHA</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (isLoadingCampaigns && currentView === 'home') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Loader2 className="animate-spin text-indigo-600 mb-4" size={48} />
        <p className="text-gray-600 font-medium">Carregando campanha...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center min-h-screen p-4 md:p-8">
      {currentView === 'home' && renderHome()}
      {currentView === 'create' && renderCreate()}
      {currentView === 'list' && renderList()}
      {currentView === 'participate' && renderParticipate()}

      <footer className="mt-auto py-8 text-center text-xs text-gray-400">
        <p>
          Criado por <a href="https://instagram.com/andersonlopesdsgn" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">@andersonlopesdsgn</a>
        </p>
      </footer>
    </div>
  );
}

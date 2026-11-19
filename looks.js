/* Creative display-referred looks. These are not Blackmagic LUTs, Log transforms
   or film-stock emulations. Every preview/export uses the same CSS-filter recipe. */
window.CameraLooks = (() => {
  'use strict';
  const categories = [{ id: 'all', label: 'Todos' }, { id: 'cinema', label: 'Cinema' }, { id: 'film', label: 'Filme' }, { id: 'mono', label: 'P&B' }, { id: 'basic', label: 'Básicos' }];
  const presets = [
    { id: 'none', label: 'Nenhum', category: 'basic', css: '', description: 'Cores originais, sem preset aplicado.' },
    { id: 'vivid', label: 'Vívido', category: 'basic', css: 'saturate(1.65) contrast(1.1)', description: 'Cores intensas e contraste reforçado.' },
    { id: 'soft', label: 'Suave', category: 'basic', css: 'contrast(.88) brightness(1.07) saturate(.88)', description: 'Contraste leve e tons suaves.' },
    { id: 'bw', label: 'P&B', category: 'mono', css: 'grayscale(1)', description: 'Preto e branco neutro.' },
    { id: 'warm', label: 'Quente', category: 'basic', css: 'sepia(.28) saturate(1.35)', description: 'Tons quentes com cor presente.' },
    { id: 'cool', label: 'Frio', category: 'basic', css: 'hue-rotate(18deg) saturate(.88)', description: 'Cor discreta e tonalidade fria.' },
    { id: 'fade', label: 'Desbotado', category: 'basic', css: 'contrast(.8) brightness(1.14) saturate(.75)', description: 'Pretos elevados e cores desbotadas.' },
    { id: 'cinema-clean', label: 'Cinema Clean', category: 'cinema', css: 'contrast(1.12) saturate(.9) brightness(1.02)', description: 'Contraste definido e cor contida para um acabamento limpo.' },
    { id: 'cinema-soft', label: 'Cinema Soft', category: 'cinema', css: 'sepia(.06) contrast(.91) saturate(.82) brightness(1.06)', description: 'Contraste suave e calor sutil para retratos e luz difusa.' },
    { id: 'amber', label: 'Âmbar', category: 'cinema', css: 'sepia(.3) hue-rotate(-8deg) contrast(1.12) saturate(1.12)', description: 'Luz âmbar e contraste presente para cenas de clima quente.' },
    { id: 'golden-hour', label: 'Golden Hour', category: 'cinema', css: 'sepia(.28) saturate(1.25) contrast(.98) brightness(1.07)', description: 'Dourado luminoso para a sensação de fim de tarde.' },
    { id: 'blue-hour', label: 'Blue Hour', category: 'cinema', css: 'sepia(.24) hue-rotate(160deg) saturate(.78) contrast(1.08) brightness(.96)', description: 'Azul discreto, cor reduzida e clima de entardecer.' },
    { id: 'tungsten', label: 'Tungstênio', category: 'cinema', css: 'sepia(.42) hue-rotate(-12deg) saturate(1.12) contrast(1.08) brightness(1.02)', description: 'Aparência quente inspirada em interiores com luz de tungstênio.' },
    { id: 'daylight', label: 'Daylight', category: 'cinema', css: 'sepia(.035) contrast(1.04) saturate(1.06) brightness(1.03)', description: 'Cor natural e luminosidade sutil para cenas externas.' },
    { id: 'emerald', label: 'Emerald', category: 'cinema', css: 'sepia(.18) hue-rotate(55deg) saturate(.8) contrast(1.1)', description: 'Tonalidade verde discreta e contraste dramático.' },
    { id: 'vintage-35', label: 'Vintage 35', category: 'film', css: 'sepia(.3) contrast(.88) brightness(1.06) saturate(.72)', description: 'Calor nostálgico, cores suaves e pretos elevados.' },
    { id: 'film-70', label: 'Filme 70', category: 'film', css: 'sepia(.13) contrast(1.2) saturate(.85) brightness(.98)', description: 'Contraste forte, cor moderada e aparência de cinema clássico.' },
    { id: 'pastel', label: 'Pastel', category: 'film', css: 'contrast(.82) saturate(.72) brightness(1.12)', description: 'Paleta delicada, clara e de baixo contraste.' },
    { id: 'bleach', label: 'Bleach', category: 'film', css: 'grayscale(.72) contrast(1.25) saturate(.75) brightness(.98)', description: 'Cor reduzida e contraste marcado, inspirado em bleach bypass.' },
    { id: 'noir', label: 'Noir', category: 'mono', css: 'grayscale(1) contrast(1.45) brightness(.93)', description: 'Preto e branco dramático, com sombras densas.' },
    { id: 'silver', label: 'Prata', category: 'mono', css: 'grayscale(1) contrast(1.1) brightness(1.05)', description: 'Monocromático luminoso com contraste moderado.' },
  ];
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  function compose(id, strength = 1) {
    const recipe = byId.get(id)?.css || '';
    const mix = Math.max(0, Math.min(1, Number.isFinite(Number(strength)) ? Number(strength) : 1));
    if (!mix || !recipe) return '';
    return recipe.replace(/([a-z-]+)\(([-\d.]+)(deg)?\)/g, (_, name, value, unit = '') => {
      const neutral = ['contrast', 'brightness', 'saturate'].includes(name) ? 1 : 0;
      return `${name}(${Number((neutral + (Number(value) - neutral) * mix).toFixed(4))}${unit})`;
    });
  }
  return { presets, categories, get: (id) => byId.get(id) || byId.get('none'), compose };
})();

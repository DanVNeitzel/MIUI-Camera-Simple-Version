# MIUI Camera — versão simples

Câmera em HTML, CSS e JavaScript puro, sem React, npm, backend ou serviços externos. O projeto React continua separado.

## Abrir

Publique esta pasta em **HTTPS**. Para testar no computador com Python:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Execute dentro desta pasta e abra **http://localhost:8080**. Na primeira utilização, toque em **Ativar câmera** e autorize o navegador. Nas próximas aberturas, a câmera inicia automaticamente quando a API de permissões confirma que o acesso já está concedido, inclusive ao voltar à página pelo histórico. O aplicativo não usa uma preferência local como substituto da autorização real. Se o acesso estiver bloqueado, a interface orienta a alterar a permissão do site; se a consulta não for suportada ou não responder, mantém a ativação manual. No celular, use HTTPS com certificado confiável; HTTP com IP local não é suficiente. Em prévias incorporadas, abra o site diretamente em outra aba.

Se a permissão ficar pendente, você pode cancelar. O pedido de câmera tem limite de 20 segundos e o início da imagem, 10 segundos. Um stream recebido depois de cancelar é encerrado. O pedido de microfone também tem limite de 20 segundos.

## Layout e navegação

- O disparador fica centralizado no modo vertical, com galeria à esquerda e filtros/troca de câmera à direita. Ícones principais, zoom, modos e botões de fechar têm áreas de toque de pelo menos 44 px.
- Na horizontal, os controles ocupam uma faixa lateral, e a prévia usa a área restante. Os controles adicionais continuam acessíveis por rolagem quando a altura for pequena.
- As configurações usam seções recolhíveis para câmera, foto, vídeo, composição, monitoramento, sistema e armazenamento. O estado aberto/fechado das categorias fica salvo neste navegador. Cena/tomada e presets ficam em subgrupos do monitoramento. Informações de compatibilidade ficam no último grupo.
- Na galeria, busca e filtros ficam juntos. **Organizar** reúne **Álbuns**, **Backup e importação** e **Armazenamento**. Os filtros e as operações existentes continuam funcionando, incluindo favoritos protegidos.
- **Monitores** recolhe ou expande histograma, áudio e informações da prévia; a preferência fica salva no navegador. Recolher o painel mantém as ferramentas de imagem ativas. Enter e Espaço operam os títulos recolhíveis sem disparar uma captura.
- No celular, os painéis abrem pela parte inferior. Seus títulos e botões de fechar permanecem visíveis durante a rolagem. O armazenamento reúne cartões de resumo, barra de uso estimado da cota, recuperação de gravações e uma área separada para limpeza da lixeira.
- Toques e cliques não mantêm contornos de foco nos botões, seletores e sliders, inclusive após retornos de foco automáticos. A navegação por teclado preserva o indicador de foco; campos de texto continuam mostrando o foco de edição e capturas selecionadas mantêm seu destaque.

## Câmera

- Fotos JPEG, PNG e WebP; qualidade e resolução desejada selecionáveis.
- A resolução real do sensor, a dimensão do recorte e o suporte a gravação, lanterna, filtros e microfone aparecem nas configurações.
- A resolução é uma preferência: o aparelho pode entregar outra. Zoom de 1× a 8× é digital; o recorte visível é compartilhado entre prévia, foto e vídeo.
- Temporizador alternando entre **desligado → 3s → 5s → 7s → 10s**, grade de terços/quadrado/ambas, seleção de câmeras e lanterna conforme suporte do aparelho.
- Noturno, retrato e PRO são efeitos digitais. Não há ajuste real de ISO, foco, abertura, exposição do sensor ou segmentação de pessoas.
- Vídeos com microfone opcional. Durante a gravação, modo, dispositivo e configurações ficam bloqueados. Não feche a página antes de o vídeo aparecer na galeria.
- Em **Configurações → Vídeo → Entrada do microfone**, escolha **Padrão do sistema** ou uma entrada disponível. Os nomes são atualizados quando o navegador disponibiliza os dispositivos após a permissão. A escolha fica salva neste navegador. Se a entrada salva não estiver disponível, selecione outra; o app não inicia silenciosamente um vídeo sem faixa de áudio quando o microfone está ligado.
- O vídeo prefere **MP4 com H.264/AAC**, quando o navegador suporta, e usa **WebM/Opus** como alternativa. A faixa de áudio deve estar ativa e habilitada antes de iniciar. O nome do microfone e seu estado aparecem durante a gravação; interrupções e ausência prolongada de sinal produzem avisos, inclusive quando o medidor visual está recolhido ou desligado. **−60 dBFS** é o piso exibido pelo medidor: se permanecer nesse valor enquanto você fala, confira a entrada selecionada, a permissão do site no Chrome e o acesso ao microfone no Android.
- Ao abrir um vídeo na galeria, o player é iniciado sem silenciamento e com seu volume em 100%; o volume de mídia do aparelho continua sendo controlado pelo sistema. A prévia da câmera permanece sem reprodução do microfone para evitar eco. As propriedades das novas gravações informam se uma faixa de áudio foi incluída; arquivos antigos podem não ter essa informação.
- Em **Configurações → Tecla de captura**, habilite o atalho de teclado. **Espaço** captura na tela da câmera mesmo com um botão focado; **Enter** captura com foco na prévia e preserva a ação normal dos botões quando eles estão focados. No modo vídeo, o atalho inicia ou para a gravação. Ele não atua em diálogos, campos ou ranges. A opção não controla os botões de volume do celular.
- Os filtros ficam em um menu dedicado: toque no ícone de **varinha ao lado de inverter a câmera**. A escolha aparece imediatamente na prévia, é usada nas fotos/vídeos e fica salva nas preferências. Você pode deslizar a lista horizontalmente e fechar o painel por **X**, **Escape** ou tocando fora. Escolha o filtro antes de iniciar uma gravação.
- Toque na imagem para solicitar foco automático. **Toque e segure** por cerca de meio segundo para solicitar o bloqueio; quando aceito, o indicador mostra um cadeado. O range de iluminação fica ao lado do ponto tocado e pode ser ajustado sem liberar o foco. Use **Desbloquear** para retornar ao automático.
- O controle real de foco depende das capacidades expostas pela câmera e pelo navegador. Quando indisponível, a interface informa isso e não simula um bloqueio. No PRO, o range de foco manual aparece somente quando suportado. A API não confirma nitidez óptica: o indicador informa o modo solicitado/aceito pelo dispositivo.
- Sem controle de foco, o toque continua posicionando o range de iluminação. Uma orientação discreta aparece apenas uma vez por câmera/sessão. Modos que o navegador rejeitar por incompatibilidade não são repetidos nessa sessão; o app tenta os modos alternativos disponíveis. Reabrir a câmera permite verificar o suporte novamente. Essa limitação não impede capturas, gravação ou iluminação.
- Os ranges têm área de toque de pelo menos 48 px, trilho com progresso, valor visível e suporte ao teclado. Ajustes horizontais também têm botões **− / +**; o brilho lateral tem orientação vertical. Alterar esse brilho é um ajuste digital e não modifica a distância de foco.
- Ao iniciar um novo foco por toque ou gesto de segurar, a iluminação volta para **100%**, inclusive no modo de iluminação sem suporte a foco. Depois, você pode ajustá-la novamente mantendo o foco travado.
- No estado automático, o controle de iluminação fica oculto e o brilho lateral permanece em **100%**. Ele aparece ao tocar para focar e some após 5 segundos sem interação, restaurando 100%. Enquanto você arrasta, ele permanece visível; com o foco travado, fica disponível até desbloquear. Desbloquear ou trocar de câmera também oculta o controle e restaura 100%.

## Presets cinematográficos

O botão de filtros inclui **21 opções**: os 7 filtros anteriores e **14 presets criativos** organizados por família. Cinema: Cinema Clean, Cinema Soft, Âmbar, Golden Hour, Blue Hour, Tungstênio, Daylight e Emerald. Filme: Vintage 35, Filme 70, Pastel e Bleach. P&B: Noir e Prata, além do preto e branco neutro anterior.

O range **Intensidade** combina cada receita com o estado neutro: **0%** não aplica o preset e **100%** aplica sua força completa. O nome e a intensidade são salvos nas preferências. Os mesmos presets estão no editor, que preserva o original ao salvar uma cópia.

A inspiração é o fluxo de looks/LUTs da [Blackmagic Camera](https://www.blackmagicdesign.com/products/blackmagiccamera). São receitas criativas próprias aplicadas no navegador, não LUTs oficiais, reprodução de ciência de cor Blackmagic, gravação Log ou simulação calibrada de película. Não há importação de arquivos `.cube`. Prévia, fotos e vídeos usam a mesma receita; os efeitos ficam incorporados nos arquivos exportados.

## Ferramentas inspiradas no Blackmagic Camera

Em **Configurações → Monitoramento cinematográfico**, ative individualmente:

- **Zebra** com limite de luminância de 70, 80, 90, 95 ou 100% e **histograma** de luminância ao vivo.
- **Peaking** vermelho com três sensibilidades para destacar contornos de maior contraste. Não confirma nitidez óptica.
- **False color** com legenda na prévia: roxo para sombras profundas, azul para sombras, verde para tons médios, amarelo para altas luzes e vermelho para valores próximos do branco. É uma escala própria de luminância, sem calibração de sensor, Log ou IRE.
- **Guias** 2.39:1, 1.85:1 e 9:16, além de área segura de 90%. Servem para compor, sem recortar o arquivo exportado.
- **Medidor de áudio** durante gravações com microfone: pico em dBFS e aviso de pico alto a partir de −1 dBFS. Usa Web Audio sem reproduzir o microfone nos alto-falantes. O medidor é encerrado ao parar a gravação.
- **Painel de gravação** com dimensões do arquivo, FPS informado pela câmera, taxa observada de desenho, formato efetivo, duração e bytes recebidos do gravador. O tamanho é parcial até a finalização; a taxa de desenho não confirma os FPS codificados no arquivo.
- **Look somente na prévia**: o preset criativo aparece no monitor, mas não é incorporado em fotos ou vídeos. Recorte, zoom e ajustes digitais do modo continuam aplicados. Com a opção desligada, o preset é incorporado como antes.

As ferramentas analisam a imagem já processada pelo navegador, no máximo dez vezes por segundo. Zebra, histograma, peaking, false color e guias nunca são gravados nas capturas. A análise é pausada com a página oculta ou a galeria aberta (exceto durante gravação). A preferência de FPS aceita 24, 25, 30 ou 60; câmera, navegador e desempenho podem limitar a taxa efetiva. Evite ocultar a página durante gravações.

Em **Presets de configuração**, dê um nome e salve até 20 configurações. O preset inclui câmera, resolução, modo, zoom, temporizador, ajustes digitais, filtro/intensidade e ferramentas de monitoramento. Aplicar um preset com a câmera ativa reabre o dispositivo; se a câmera salva não estiver disponível, usa a preferência de câmera. Projeto, cena e contador de tomada são independentes dos presets.

Em **Cena e tomada**, informe projeto, cena e próxima tomada. Cada foto ou vídeo finalizado recebe esses dados e incrementa o contador. Cópias do editor preservam os dados da captura original. Na galeria, busque projeto/cena/tomada e use **Opções → Marcar melhor tomada** ou **Editar cena e tomada**. O filtro **Melhores tomadas** reúne as marcações. Os dados e marcações ficam no catálogo local, aparecem nas propriedades e são preservados no backup `.miuicam`; não são metadados embutidos no JPEG/MP4. Preferências e presets de configuração ficam no localStorage e não fazem parte do backup de mídia.

## Galeria e lixeira

A galeria ocupa toda a página. O botão **⛶** pode ocultar também as barras do navegador quando suportado.

- Toque para abrir; deslize horizontalmente para trocar fotos. Use dois dedos para ampliar e um dedo para mover a foto ampliada. Dois toques alternam o zoom. Um toque curto esconde/mostra os controles. As setas do teclado também navegam. Vídeos preservam os controles nativos.
- Há agrupamento por data local e filtros para fotos, vídeos, favoritos e lixeira.
- A grade começa com **36 capturas**; **Carregar mais** acrescenta outro lote. Miniaturas de até **256 px** são carregadas perto da área visível. Os originais são lidos somente ao abrir, editar, compartilhar, baixar ou fazer backup.
- Use **Selecionar**, marque as capturas e abra **Opções**. **Selecionar todas** inclui todos os itens do filtro atual, mesmo os que ainda não apareceram na grade.
- Segure uma miniatura por cerca de meio segundo, use o botão direito ou `Shift + F10` para abrir o menu. Ao segurar um item já marcado, o menu usa todo o conjunto selecionado.
- O menu inclui favoritos, compartilhamento, download, editor, propriedades e exclusão. O download de várias capturas gera um ZIP sem bibliotecas externas.
- O compartilhamento usa o painel nativo quando disponível. Preparar arquivos grandes pode exigir um segundo toque em **Compartilhar**. Caso o navegador não ofereça esse recurso, use **Baixar**.
- **Excluir** oferece duas opções: **Mover para a lixeira**, que mantém os itens por **30 dias** e oferece **Desfazer** por 15 segundos, ou **Excluir diretamente, sem lixeira**, que exige confirmação e apaga os arquivos permanentemente, sem possibilidade de desfazer. As opções valem para capturas individuais e seleções em lote; favoritos continuam protegidos. Para recuperar uma exclusão enviada à lixeira depois que o aviso sumir, use **Lixeira → Restaurar**.
- O aviso de exclusão ocupa espaço no cabeçalho da galeria, sem cobrir os botões do rodapé. Use **×** para dispensá-lo ou **Escape** quando o foco estiver no aviso. Dispensar apenas fecha a mensagem; os arquivos continuam na lixeira e podem ser restaurados por lá.
- **Favoritos são protegidos contra exclusão**, inclusive em seleções mistas, exclusão permanente e limpeza automática da lixeira. Em lote, somente os itens sem favorito são excluídos. Remova a marcação de favorito antes de excluir. A proteção também verifica o estado atual salvo no banco para impedir exclusões com uma seleção desatualizada de outra aba. Favoritos de backups antigos são restaurados mesmo com prazo de lixeira vencido.
- Itens vencidos são removidos ao abrir o aplicativo; não há processo rodando quando ele está fechado. A exclusão permanente dentro da lixeira exige confirmação e não pode ser desfeita.
- Atualizações de favoritos, exclusões e restaurações em lote são transacionais. Falhas no armazenamento preservam o estado anterior.

## Editor

Uma foto por vez: girar, espelhar, recorte livre, proporções 1:1, 9:16, 16:9 e 3:4, brilho, contraste, saturação e filtros. O recorte livre permite escolher largura, altura e posição; nas proporções fixas, a largura controla o tamanho da área. **Ver antes / Ver depois** compara o original com a edição. **Salvar cópia** mantém o original.

As propriedades mostram tipo, tamanho, data, dimensões, favoritos e estado de salvamento; vídeos também mostram a duração quando disponível. Não há extração de EXIF ou localização.

## Álbuns, espaço e recuperação de vídeos

Em **Galeria → Álbuns**, crie ou renomeie álbuns personalizados. Selecione capturas e use **Opções → Adicionar ou remover de um álbum**. Uma captura pode pertencer a até 50 álbuns, sem duplicar o arquivo. O seletor de álbuns combina com os filtros já existentes e inclui **Sem álbum**. Remover um álbum mantém todas as fotos, vídeos e favoritos. Cópias feitas no editor preservam os álbuns do original. O aplicativo permite até 500 álbuns.

Em **Galeria → Armazenamento** ou **Configurações → Armazenamento e recuperação**, consulte quantidades e tamanhos de fotos, vídeos, lixeira, favoritos e rascunhos de vídeo. Favoritos estão incluídos nas categorias anteriores e não devem ser somados novamente. O tamanho das capturas é calculado pelo catálogo, sem carregar todos os originais. A cota estimada do navegador inclui cache, miniaturas e demais dados da mesma origem; não representa o espaço livre total do aparelho. O botão de proteção solicita armazenamento persistente ao navegador, que pode recusar. Ele não substitui o backup.

**Esvaziar lixeira** exige confirmação e remove permanentemente somente os itens sem favorito, independentemente do álbum selecionado. Favoritos continuam protegidos pela verificação dentro da transação do banco.

Durante a gravação, os trechos recebidos do `MediaRecorder` são gravados em sequência no IndexedDB. A tela informa se essa proteção está ativa. Ao finalizar com sucesso, o vídeo entra na galeria e os trechos temporários são removidos na mesma transação. Uma falha de armazenamento mantém a gravação em memória e avisa para baixar o vídeo; trechos já salvos podem continuar disponíveis.

Após uma interrupção, abra **Armazenamento → Gravações interrompidas**. **Recuperar na galeria** tenta reproduzir e salvar os trechos, preservando projeto, cena, tomada e data. **Baixar parcial** mantém o rascunho para outras tentativas. **Descartar rascunho** exige um segundo toque explícito. Nenhum rascunho é descartado automaticamente. Os bytes ainda não entregues pelo gravador antes da interrupção não podem ser recuperados, e alguns formatos parciais podem não reproduzir. Os rascunhos não fazem parte do backup de mídia: recupere ou baixe primeiro.

Quando disponível, Web Locks impede recuperar ou descartar uma gravação em uso em outra aba. Sem essa API, uma atividade recente bloqueia a operação por até dois minutos. A recuperação preserva um único ID por gravação para impedir duplicatas após uma tentativa interrompida. Gravações longas ainda usam memória até a finalização; o salvamento de trechos acrescenta uma oportunidade de recuperação, sem garantia de recuperação após qualquer falha.

## Backup e importação

Em **Galeria → Backup**, exporte um arquivo **.miuicam** com fotos, vídeos, favoritos, lixeira e álbuns. O arquivo contém os originais, sem conversão para Base64. A restauração cria novos IDs de álbum e remapeia os vínculos das capturas, preservando a coleção existente; nomes repetidos recebem o sufixo “importado”. Backups antigos sem álbuns continuam aceitos. Guarde uma cópia fora do navegador.

A restauração valida o cabeçalho, tamanhos e metadados antes de gravar. Adiciona novas cópias, sem sobrescrever a coleção atual. Se houver uma falha de gravação, a importação inteira é cancelada. Itens de lixeira já vencidos não são restaurados. Um backup pode conter até 10.000 arquivos; grandes coleções podem levar tempo e exigir espaço livre. Preferências da câmera não fazem parte do backup.

## Instalar e abrir offline

O aplicativo instalado solicita **tela cheia ao iniciar** pelo manifesto (`display: fullscreen`, com fallback `standalone`). O sistema pode aplicar suas próprias limitações, especialmente no iPhone. Quando aberto como uma aba do navegador, o primeiro toque na interface ou uso do teclado solicita tela cheia onde a API permitir; essa entrada depende de uma interação real e não pode ser garantida no carregamento da página. Se o navegador bloquear, use **Configurações → Aplicativo → Entrar em tela cheia** ou instale na tela inicial. Sair voluntariamente da tela cheia não provoca novas solicitações automáticas nessa abertura. Abrir e fechar a galeria mantém a tela cheia do aplicativo; o botão de expansão da galeria continua permitindo alternar explicitamente.

O ícone usa um desenho vetorial editável em `icons/app-icon.svg`, com lente de diafragma laranja e fundo grafite. Os PNGs de 192/512 px atendem à instalação, a versão de 512 px mantém o desenho essencial dentro da área segura de recortes maskable, `apple-touch-icon.png` atende ao atalho de 180 px do iPhone e `favicon-32.png`/SVG à aba do navegador. Para regenerar os PNGs a partir do SVG, execute `node simples_version/icons/build-icons.mjs` na raiz do projeto, com Node 22+ e Chrome/Chromium disponível (ou `CHROME_PATH` configurado).

A pasta inclui manifesto, ícones e service worker. Após abrir uma vez com conexão, a interface fica disponível offline, junto da galeria local. Use **Configurações → Instalar aplicativo** ou o menu do navegador. No Safari, use **Compartilhar → Adicionar à Tela de Início**. A disponibilidade da instalação depende do navegador e de HTTPS/localhost.

O cache guarda somente HTML, CSS, JavaScript, manifesto e ícones. As fotos não são copiadas para o cache nem enviadas à rede. Para aplicar uma atualização pendente, feche todas as abas do aplicativo e abra novamente. O service worker tem escopo limitado a esta pasta.

O servidor deve entregar `.js` como JavaScript, `.webmanifest` como `application/manifest+json` e `.png` como imagem. Os caminhos são relativos e permitem hospedagem em subdiretórios.

Os ícones usam **Font Awesome Free 6.7.2**, hospedado localmente em `vendor/fontawesome/`, sem CDN ou kit remoto. Estilos solid/regular e fontes WOFF2 também são incluídos no cache offline. A licença original está em `vendor/fontawesome/LICENSE.txt`. No servidor, use `font/woff2` para as fontes. A origem dos arquivos é o [repositório oficial do Font Awesome](https://github.com/FortAwesome/Font-Awesome/tree/6.7.2).

## Armazenamento e compatibilidade

Preferências ficam no `localStorage` (`miui-camera-simple-settings`). O IndexedDB (`miui-camera-simple`, versão 3) separa **originais**, **catálogo**, **miniaturas**, **álbuns**, **gravações pendentes** e **trechos de gravação**. A versão anterior da galeria é migrada um arquivo por vez. O banco da versão React é independente e não é importado automaticamente.

Os dados pertencem ao navegador e à origem (protocolo, host e porta). Limpar os dados do site, usar navegação privada ou a limpeza automática do navegador pode apagar a coleção, incluindo a lixeira. PWA e lixeira não substituem o backup.

Se o armazenamento falhar durante uma captura, ela permanece na memória com aviso para download imediato. Gravações longas ficam em memória até serem finalizadas. Captura de vídeo exige `MediaRecorder` e `canvas.captureStream`; efeitos de cor exigem filtros no canvas. Evite bloquear o celular ou ocultar a aba enquanto grava.

## Arquivos e validação

- `index.html`, `style.css`, `script.js`: interface e operações.
- `storage.js`: banco, miniaturas, migração e transações; `ranges.js`: controles deslizantes para toque e teclado; `looks.js`: catálogo e intensidade dos presets.
- `collection.js` e `collection.css`: álbuns, painel de armazenamento e recuperação de vídeos; `cinema.js` e `cinema.css`: ferramentas de monitoramento e presets de configuração.
- `layout.js` e `layout.css`: organização dos controles, grupos recolhíveis, menu Organizar, cartões e comportamento visual responsivo.
- `fullscreen.js`: ativação de tela cheia no primeiro gesto, botão manual e tratamento de limitações do navegador.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalação e interface offline.
- `tests/run-browser-tests.mjs`: validação com câmera simulada e coleção descartável em um perfil isolado do Chrome.

Verifique a sintaxe com `node --check script.js` e `node --check storage.js`. Para os testes de navegador, use **Node 22 ou superior** e Chrome/Chromium instalado:

```sh
node tests/run-browser-tests.mjs
```

Se necessário, informe o executável na variável de ambiente `CHROME_PATH`. O teste usa um servidor somente em localhost, cria seu próprio perfil e não acessa suas fotos ou perfil pessoal.

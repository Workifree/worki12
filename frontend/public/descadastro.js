// Confirmação de descadastro. Abrir a página NÃO altera nada: só o clique envia o POST.
;(function () {
  var ENDPOINT = 'https://vrklakcbkcsonarmhqhp.supabase.co/functions/v1/notice-unsubscribe'
  var token = new URLSearchParams(window.location.hash.slice(1)).get('t')
  var mensagem = document.getElementById('mensagem')
  var botao = document.getElementById('confirmar')

  function encerrar(texto) {
    mensagem.textContent = texto
    botao.hidden = true
  }

  if (!token) {
    encerrar('Link incompleto. Abra o link do e-mail novamente.')
    return
  }

  botao.addEventListener('click', function () {
    botao.disabled = true
    window
      .fetch(ENDPOINT + '?t=' + encodeURIComponent(token), { method: 'POST' })
      .then(function (res) {
        if (res.ok) return encerrar('Pronto. Você não vai mais receber avisos por e-mail.')
        if (res.status === 400) return encerrar('Este link venceu. Desligue o e-mail nas preferências de avisos do app.')
        throw new Error('falha')
      })
      .catch(function () {
        botao.disabled = false
        mensagem.textContent = 'Não deu certo agora. Tente de novo em instantes.'
      })
  })
})()

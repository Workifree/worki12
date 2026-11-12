// Comportamento da página offline (arquivo externo — não depende de script inline, compatível com CSP script-src 'self').
// Sem JavaScript o botão "Tentar de novo" ainda funciona: é um link para a própria URL.
;(function () {
  var retry = document.getElementById('retry')
  if (retry) {
    retry.addEventListener('click', function (event) {
      event.preventDefault()
      window.location.reload()
    })
  }
  // Voltou a conexão: recarrega sozinho.
  window.addEventListener('online', function () {
    window.location.reload()
  })
})()

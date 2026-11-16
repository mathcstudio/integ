# src/ 의 CSS·문제·앱 코드를 합쳐 (1) 앱스크립트용 index.html (2) 미리보기용 preview.html 을 만든다
import io
r=lambda f: io.open('src/'+f,encoding='utf-8').read()
css,climb,appjs=r('app.css'),r('climb.js'),r('app.js')
for n,js in (('climb',climb),('app',appjs)): assert '</script' not in js, n
FONT='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700&display=swap">'
MJCFG='''<script>
window.MathJax = { tex: { inlineMath: [["\\\\(", "\\\\)"]] }, svg: { fontCache: "global" }, startup: { typeset: false,
  ready: function () { MathJax.startup.defaultReady(); MathJax.startup.promise.then(function () { window.__mjReady = true; window.__typeset && window.__typeset(); }); } } };
</script>'''
MJ='<script src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js" async></script>'
body='<div class="wrap" id="app"></div>\n'+MJCFG+'\n<script>\n'+climb+'\n</script>\n<script>\n'+appjs+'\n</script>\n'+MJ+'\n'
gas='<!DOCTYPE html>\n<html lang="ko">\n<head>\n<base target="_top">\n<meta charset="utf-8">\n'+FONT+'\n<style>\n'+css+'</style>\n</head>\n<body>\n'+body+'</body>\n</html>\n'
io.open('index.html','w',encoding='utf-8').write(gas)
prev='<title>정적분 등반 미리보기</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'+FONT+'\n<style>\n'+css+'</style>\n'+body
io.open('preview.html','w',encoding='utf-8').write(prev)
print(len(gas),len(prev))

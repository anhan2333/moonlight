/* 首次3.8s开场动画 / 以后跳过（照截图建议）*/
(function(){
  try{
    if (localStorage.getItem('moonlight_intro_seen')){
      document.documentElement.classList.add('mln-skip');
    } else {
      localStorage.setItem('moonlight_intro_seen', '1');
    }
  }catch(e){}
})();

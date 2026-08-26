const navItems=[...document.querySelectorAll('.nav-item')];
const canvas=document.getElementById('workspaceCanvas');

function renderPage(page){
  canvas.replaceChildren();
  canvas.dataset.page=page;

  if(page==='matching'){
    const frame=document.createElement('iframe');
    frame.className='workspace-frame';
    frame.src='./matching/index.html';
    frame.title='RAPTOR Matching';
    frame.setAttribute('loading','eager');
    canvas.appendChild(frame);
  }
}

function activate(page){
  navItems.forEach(button=>{
    const active=button.dataset.page===page;
    button.classList.toggle('is-active',active);
    if(active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  renderPage(page);
}

navItems.forEach(button=>button.addEventListener('click',()=>activate(button.dataset.page)));
activate('pipeline');

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.env.PORT || 4174;
const types = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml'
};

http.createServer((req,res)=>{
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const filePath = path.join(root, safePath || 'index.html');
  if(!filePath.startsWith(root)){
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data)=>{
    if(err){
      fs.readFile(path.join(root, 'index.html'), (fallbackErr, fallback)=>{
        if(fallbackErr){ res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, {'Content-Type': types['.html'], 'Cache-Control':'no-store'});
        res.end(fallback);
      });
      return;
    }
    res.writeHead(200, {'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(data);
  });
}).listen(port, ()=>console.log(`Fit met Dicky running at http://localhost:${port}`));
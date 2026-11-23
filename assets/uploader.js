// Plan uploads for the intake forms (see functions/api/upload.js). Files go to private
// Cloudflare R2 storage in 10 MB parts; the form then sends only the list of stored files.
window.SCPUpload = (function(){
  var API = '/api/upload';
  var PART = 10 * 1024 * 1024;
  var MAX_FILES = 20, MAX_FILE = 1024 * 1024 * 1024, MAX_TOTAL = 2 * 1024 * 1024 * 1024;
  var EXT = ['pdf','zip','7z','rar','dwg','dxf','dwf','dwfx','rvt','rfa','ifc','skp','nwd','nwc',
    'png','jpg','jpeg','tif','tiff','heic','webp','gif','bmp','xlsx','xls','csv','docx','doc','txt','rtf'];

  function call(action, options, query){
    return fetch(API + '?action=' + action + (query || ''), options).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(body){
        if (!r.ok){ throw new Error(body.error || ('status ' + r.status)); }
        return body;
      });
    });
  }
  function post(action, body){
    return call(action, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
  }
  function retry(fn, tries){
    return fn().catch(function(err){ if (tries <= 1){ throw err; } return retry(fn, tries - 1); });
  }
  function mb(bytes){ return bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }

  function uploadFile(file, submission, onBytes){
    return post('create', {submission:submission, name:file.name, size:file.size}).then(function(created){
      var parts = [], offset = 0, number = 1;
      function next(){
        if (offset >= file.size){
          return post('complete', {key:created.key, uploadId:created.uploadId, parts:parts});
        }
        var chunk = file.slice(offset, offset + PART), partNumber = number;
        var query = '&key=' + encodeURIComponent(created.key) + '&uploadId=' + encodeURIComponent(created.uploadId) + '&part=' + partNumber;
        return retry(function(){ return call('part', {method:'PUT', body:chunk}, query); }, 3).then(function(done){
          parts.push({partNumber:done.partNumber, etag:done.etag});
          offset += chunk.size;
          number += 1;
          onBytes(chunk.size);
          return next();
        });
      }
      return next().catch(function(err){
        post('abort', {key:created.key, uploadId:created.uploadId}).catch(function(){});
        throw err;
      });
    });
  }

  return {
    ACCEPT: EXT.map(function(e){ return '.' + e; }).join(','),

    // Resolves true only when the site's storage is connected, so the form can fall back to links.
    ready: function(){
      return fetch(API + '?action=status', {cache:'no-store'})
        .then(function(r){ return r.ok ? r.json() : {}; })
        .then(function(body){ return body.ready === true; })
        .catch(function(){ return false; });
    },

    // Returns an error message, or '' when the files can be uploaded.
    check: function(files){
      var total = 0;
      for (var i = 0; i < files.length; i++){
        var ext = files[i].name.split('.').pop().toLowerCase();
        if (EXT.indexOf(ext) === -1){ return files[i].name + ': .' + ext + ' files are not accepted. Put them in a ZIP, or paste a link instead.'; }
        if (files[i].size > MAX_FILE){ return files[i].name + ' is over 1 GB. Paste a Google Drive, Dropbox or OneDrive link for it instead.'; }
        total += files[i].size;
      }
      if (files.length > MAX_FILES){ return 'Up to 20 files per request. Put the rest in a ZIP, or paste a link instead.'; }
      if (total > MAX_TOTAL){ return 'These files add up to more than 2 GB. Paste a Google Drive, Dropbox or OneDrive link instead.'; }
      return '';
    },

    // Uploads the files one after another; onProgress(percent) as bytes arrive.
    // Resolves to the lines that go into the notification email.
    upload: function(files, onProgress){
      var submission = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      var total = 0, sent = 0, lines = [];
      files.forEach(function(f){ total += f.size; });
      var chain = Promise.resolve();
      files.forEach(function(file){
        chain = chain.then(function(){
          return uploadFile(file, submission, function(n){
            sent += n;
            onProgress(Math.min(99, Math.round(sent / total * 100)));
          }).then(function(done){ lines.push(file.name + ' (' + mb(file.size) + ') → ' + done.key); });
        });
      });
      return chain.then(function(){ onProgress(100); return lines; });
    }
  };
})();

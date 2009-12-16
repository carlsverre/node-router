if(!debug) {
  var sys = require('sys');
  sys.info = sys.puts;
} else {
  var sys = {};
  sys.debug = debug;
  sys.puts = info;
  sys.info = info;
}

var http = require('http');
var multipart = require('multipart');
var posix = require('posix');

var NOT_FOUND = "Not Found\n";
var routes = [];
var middleware = {
  request_processors: [],
  headers:            []
};

function notFound(req, res, message) {
  sys.debug("notFound!");
  message = message || NOT_FOUND;
  res.sendHeader(404, [ ["Content-Type", "text/plain"],
                        ["Content-Length", message.length]
                      ]);
  res.sendBody(message);
  res.finish();
}

var format_parsers = {
  json: function (data) {
    return JSON.parse(data)
  },
  urlencoded: function (data) {
    var parts = data.split("&");
    data = {};
    for (var j in parts) {
      var k = parts[j].split("=");
      data[k[0]] = unescape(k[1]);
    }
    return data;
  }
}

var addMiddleware = function (obj) {
  if(obj['process_request']) {
    middleware.request_processors.push(obj.process_request);
  }
  if(obj['headers']) {
    middleware.headers.push(obj.headers);
  }
}

function addRoute(method, pattern, handler, format) {
	var route = {
    method: method,
    pattern: pattern,
    handler: handler
  };
	if (format !== undefined) {
		route.format = format;
	}
  routes.push(route);
}

/**
 * map_urls will map a specially formatted array into a url structure.
 *
 * The array must be formatted as so:
 
    urls = [PREFIX_STRING,
      [UPPERCASE_METHOD_STRING, REGEX_MATCH_STRING, CONTROLLER_FUNCTION, FORMAT_IF_POST/PUT]
    ];

 */
var map_urls = function (urls) {
  var prefix = '';
  for (var i in urls) {
    if (i == 0) {
      prefix = urls[i];
      continue;
    }

    var url = urls[i];

    var method    = url[0],
        pattern   = prefix + url[1],
        handler   = url[2],
        format    = url[3];

    addRoute(method, new RegExp(pattern), handler, format);
  }
}

var get = function (pattern, handler) {
  return addRoute("GET", pattern, handler);
};

var post = function (pattern, handler, format) {
  return addRoute("POST", pattern, handler, format);
};

var put = function (pattern, handler, format) {
  return addRoute("PUT", pattern, handler, format);
};

var del = function (pattern, handler) {
  return addRoute("DELETE", pattern, handler);
};

var resource = function (name, controller, format) {
  get(new RegExp('^/' + name + '$'), controller.index);
  get(new RegExp('^/' + name + '/([^/]+)$'), controller.show);
  post(new RegExp('^/' + name + '$'), controller.create, format);
  put(new RegExp('^/' + name + '/([^/]+)$'), controller.update, format);
  del(new RegExp('^/' + name + '/([^/]+)$'), controller.destroy);
};

var resourceController = function (name, data, on_change) {
	data = data || [];
	on_change = on_change || function () {};
	return {
		index: function (req, res) {
			res.simpleJson(200, {content: data, self: '/' + name});
		},
		show: function (req, res, id) {
			var item = data[id];
			if (item) {
				res.simpleJson(200, {content: item, self: '/' + name + '/' + id});
			} else {
				res.notFound();
			}
		},
    create: function (req, res, json) {
      var id, url;
      if (!json) {
        res.notFound();
      } else {
        data.push(json);
        id = data.length - 1;
        on_change(id);
        url = "/" + name + "/" + id;
        res.simpleJson(201, {content: json, self: url}, [["Location", url]]);
      }
		},
    update: function (req, res, id, json) {
      if (!json) {
        res.notFound();
      } else {
        data[id] = json;
        on_change(id);
        res.simpleJson(200, {content: json, self: "/" + name + "/" + id});
      }
		},
		destroy: function (req, res, id) {
      delete(data[id]);
			on_change(id);
			res.simpleJson(200, "200 Destroyed");
		}
	};
};

var server = http.createServer(function (req, res) {
  var path = req.uri.path;
  sys.puts(req.method + " " + path);

  req.template_params = {};

  res.simpleResponse = function (code, body, extra_headers, content_type) {
    var headers = {};

    // Add middleware headers
    for (i in middleware.headers) {
      var mw_headers = middleware.headers[i](req);
      process.mixin(headers, mw_headers);
    }

    // Add simple headers
    var simple_headers = {};
    simple_headers["Content-Type"] = content_type;
    simple_headers["Content-Length"] = body.length;

    process.mixin(headers, simple_headers);
    process.mixin(headers, extra_headers);

    res.sendHeader(code, headers);
    res.sendBody(body);
    res.finish();
  };

  res.simpleText = function (code, body, extra_headers) {
    res.simpleResponse(code, body, extra_headers, "text/plain");
  };

  res.simpleHtml = function (code, body, extra_headers) {
    res.simpleResponse(code, body, extra_headers, "text/html");
  };

  res.simpleJson = function (code, json, extra_headers) {
		var body = JSON.stringify(json);
    res.simpleResponse(code, body, extra_headers, "application/json");
  };

  res.redirect = function (redirect_url) {
    res.simpleResponse(302, "", {Location: redirect_url}, "text/html");
  }

  res.notFound = function (message) {
		notFound(req, res, message);
  };

  // Call middleware request_processors
  var rp = middleware.request_processors;
  for (i in rp) {
    req = rp[i](req,res);
    if(req==null) return;
  }

  for (var i = 0, l = routes.length; i < l; i += 1) {
    var route = routes[i];

    if (req.method === route.method) {
      var match = path.match(route.pattern);

      if (match && match[0].length > 0) {
        match.shift();
        match = match.map(unescape);
        match.unshift(res);
        match.unshift(req);

        if (route.format ==  'multipart') {
          multipart.parse(req).addCallback(function (obj) {
            match.push(obj);
            route.handler.apply(null, match);
          });
          return;
        }
        
        if (route.format !== undefined) {
          var body = "";
          req.setBodyEncoding('utf8');

      	  req.addListener('body', function (chunk) {
      	    body += chunk;
          });

          req.addListener('complete', function () {
            if(route.format in format_parsers) {
              body = format_parsers[route.format](body);
            }

      	    match.push(body);
            route.handler.apply(null, match);
          });
          return;
        }

        route.handler.apply(null, match);
        return;
      }
    }

  } // end for loop

  notFound(req, res);
  return;

});

var listen = function (port, host) {
  server.listen(port, host);
  sys.puts("Server at http://" + (host || "127.0.0.1") + ":" + port.toString() + "/");
};

var close = function () { server.close(); };

function extname (path) {
  var index = path.lastIndexOf(".");
  return index < 0 ? "" : path.substring(index);
}

var staticHandler = function (req, res, filename) {
  var body, headers;
  var content_type = mime.lookupExtension(extname(filename));
  var encoding = (content_type.slice(0,4) === "text" ? "utf8" : "binary");

  function loadResponseData(callback) {
    if (body && headers) {
      callback();
      return;
    }

    posix.cat(filename, encoding).addCallback(function (data) {
      body = data;
      headers = [ [ "Content-Type"   , content_type ],
                  [ "Content-Length" , body.length ]
                ];
      headers.push(["Cache-Control", "public"]);
       
      callback();
    }).addErrback(function () {
      notFound(req, res, "Cannot find file: " + filename);
    });
  }

  loadResponseData(function () {
    res.sendHeader(200, headers);
    res.sendBody(body, encoding);
    res.finish();
  });
};

// stolen from jack- thanks
var mime = {
  // returns MIME type for extension, or fallback, or octet-steam
  lookupExtension : function(ext, fallback) {
    return mime.TYPES[ext.toLowerCase()] || fallback || 'application/octet-stream';
  },
  
  // List of most common mime-types, stolen from Rack.
  TYPES : {
    ".3gp"   : "video/3gpp",
    ".a"     : "application/octet-stream",
		".ai"    : "application/postscript",
		".aif"   : "audio/x-aiff",
		".aiff"  : "audio/x-aiff",
		".asc"   : "application/pgp-signature",
		".asf"   : "video/x-ms-asf",
		".asm"   : "text/x-asm",
		".asx"   : "video/x-ms-asf",
		".atom"  : "application/atom+xml",
		".au"    : "audio/basic",
		".avi"   : "video/x-msvideo",
		".bat"   : "application/x-msdownload",
		".bin"   : "application/octet-stream",
		".bmp"   : "image/bmp",
		".bz2"   : "application/x-bzip2",
		".c"     : "text/x-c",
		".cab"   : "application/vnd.ms-cab-compressed",
		".cc"    : "text/x-c",
		".chm"   : "application/vnd.ms-htmlhelp",
		".class"   : "application/octet-stream",
		".com"   : "application/x-msdownload",
		".conf"  : "text/plain",
		".cpp"   : "text/x-c",
		".crt"   : "application/x-x509-ca-cert",
		".css"   : "text/css",
		".csv"   : "text/csv",
		".cxx"   : "text/x-c",
		".deb"   : "application/x-debian-package",
		".der"   : "application/x-x509-ca-cert",
		".diff"  : "text/x-diff",
		".djv"   : "image/vnd.djvu",
		".djvu"  : "image/vnd.djvu",
		".dll"   : "application/x-msdownload",
		".dmg"   : "application/octet-stream",
		".doc"   : "application/msword",
		".dot"   : "application/msword",
		".dtd"   : "application/xml-dtd",
		".dvi"   : "application/x-dvi",
		".ear"   : "application/java-archive",
		".eml"   : "message/rfc822",
		".eps"   : "application/postscript",
		".exe"   : "application/x-msdownload",
		".f"     : "text/x-fortran",
		".f77"   : "text/x-fortran",
		".f90"   : "text/x-fortran",
		".flv"   : "video/x-flv",
		".for"   : "text/x-fortran",
		".gem"   : "application/octet-stream",
		".gemspec" : "text/x-script.ruby",
		".gif"   : "image/gif",
		".gz"    : "application/x-gzip",
		".h"     : "text/x-c",
		".hh"    : "text/x-c",
		".htm"   : "text/html",
		".html"  : "text/html",
		".ico"   : "image/vnd.microsoft.icon",
		".ics"   : "text/calendar",
		".ifb"   : "text/calendar",
		".iso"   : "application/octet-stream",
		".jar"   : "application/java-archive",
		".java"  : "text/x-java-source",
		".jnlp"  : "application/x-java-jnlp-file",
		".jpeg"  : "image/jpeg",
		".jpg"   : "image/jpeg",
		".js"    : "application/javascript",
		".json"  : "application/json",
		".log"   : "text/plain",
		".m3u"   : "audio/x-mpegurl",
		".m4v"   : "video/mp4",
		".man"   : "text/troff",
		".mathml"  : "application/mathml+xml",
		".mbox"  : "application/mbox",
		".mdoc"  : "text/troff",
		".me"    : "text/troff",
		".mid"   : "audio/midi",
		".midi"  : "audio/midi",
		".mime"  : "message/rfc822",
		".mml"   : "application/mathml+xml",
		".mng"   : "video/x-mng",
		".mov"   : "video/quicktime",
		".mp3"   : "audio/mpeg",
		".mp4"   : "video/mp4",
		".mp4v"  : "video/mp4",
		".mpeg"  : "video/mpeg",
		".mpg"   : "video/mpeg",
		".ms"    : "text/troff",
		".msi"   : "application/x-msdownload",
		".odp"   : "application/vnd.oasis.opendocument.presentation",
		".ods"   : "application/vnd.oasis.opendocument.spreadsheet",
		".odt"   : "application/vnd.oasis.opendocument.text",
		".ogg"   : "application/ogg",
		".p"     : "text/x-pascal",
		".pas"   : "text/x-pascal",
		".pbm"   : "image/x-portable-bitmap",
		".pdf"   : "application/pdf",
		".pem"   : "application/x-x509-ca-cert",
		".pgm"   : "image/x-portable-graymap",
		".pgp"   : "application/pgp-encrypted",
		".pkg"   : "application/octet-stream",
		".pl"    : "text/x-script.perl",
		".pm"    : "text/x-script.perl-module",
		".png"   : "image/png",
		".pnm"   : "image/x-portable-anymap",
		".ppm"   : "image/x-portable-pixmap",
		".pps"   : "application/vnd.ms-powerpoint",
		".ppt"   : "application/vnd.ms-powerpoint",
		".ps"    : "application/postscript",
		".psd"   : "image/vnd.adobe.photoshop",
		".py"    : "text/x-script.python",
		".qt"    : "video/quicktime",
		".ra"    : "audio/x-pn-realaudio",
		".rake"  : "text/x-script.ruby",
		".ram"   : "audio/x-pn-realaudio",
		".rar"   : "application/x-rar-compressed",
		".rb"    : "text/x-script.ruby",
		".rdf"   : "application/rdf+xml",
		".roff"  : "text/troff",
		".rpm"   : "application/x-redhat-package-manager",
		".rss"   : "application/rss+xml",
		".rtf"   : "application/rtf",
		".ru"    : "text/x-script.ruby",
		".s"     : "text/x-asm",
		".sgm"   : "text/sgml",
		".sgml"  : "text/sgml",
		".sh"    : "application/x-sh",
		".sig"   : "application/pgp-signature",
		".snd"   : "audio/basic",
		".so"    : "application/octet-stream",
		".svg"   : "image/svg+xml",
		".svgz"  : "image/svg+xml",
		".swf"   : "application/x-shockwave-flash",
		".t"     : "text/troff",
		".tar"   : "application/x-tar",
		".tbz"   : "application/x-bzip-compressed-tar",
		".tci"   : "application/x-topcloud",
		".tcl"   : "application/x-tcl",
		".tex"   : "application/x-tex",
		".texi"  : "application/x-texinfo",
		".texinfo" : "application/x-texinfo",
		".text"  : "text/plain",
		".tif"   : "image/tiff",
		".tiff"  : "image/tiff",
		".torrent" : "application/x-bittorrent",
		".tr"    : "text/troff",
		".txt"   : "text/plain",
		".vcf"   : "text/x-vcard",
		".vcs"   : "text/x-vcalendar",
		".vrml"  : "model/vrml",
		".war"   : "application/java-archive",
		".wav"   : "audio/x-wav",
		".wma"   : "audio/x-ms-wma",
		".wmv"   : "video/x-ms-wmv",
		".wmx"   : "video/x-ms-wmx",
		".wrl"   : "model/vrml",
		".wsdl"  : "application/wsdl+xml",
		".xbm"   : "image/x-xbitmap",
		".xhtml"   : "application/xhtml+xml",
		".xls"   : "application/vnd.ms-excel",
		".xml"   : "application/xml",
		".xpm"   : "image/x-xpixmap",
		".xsl"   : "application/xml",
		".xslt"  : "application/xslt+xml",
		".yaml"  : "text/yaml",
		".yml"   : "text/yaml",
		".zip"   : "application/zip"
  }
};

// Export API
process.mixin(exports, {
	listen: listen,
	close: close,
	staticHandler: staticHandler,
	mime: mime,
	resourceController: resourceController,
	resource: resource,
	get: get,
	post: post,
	put: put,
	del: del,
	map_urls: map_urls,
	addMiddleware: addMiddleware
});

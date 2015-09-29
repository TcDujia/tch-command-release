/*
 * fis
 * http://fis.baidu.com/
 */

'use strict';

exports.name = 'release';
exports.desc = '编译代码';
exports.register = function(commander){

    function watch(opt){
        var root = fis.project.getProjectPath();
        var timer = -1;
        var safePathReg = /[\\\/][_\-.\s\w]+$/i;
        function listener(path){
            if(safePathReg.test(path)){
                clearTimeout(timer);
                timer = setTimeout(function(){
                    release(opt);
                }, 500);
            }
        }
        require('chokidar')
            .watch(root, {
                ignored : /[\/\\](?:output\b[^\/\\]*([\/\\]|$)|\.|fis-conf\.js$)/i,
                // usePolling: false,
                persistent: true
            })
            .on('add', listener)
            .on('change', listener)
            .on('unlink', listener)
            .on('error', function(err){
                fis.log.error(err);
            });
    }

    function time(fn){
        process.stdout.write('\n δ '.bold.yellow);
        var now = Date.now();
        fn();
        process.stdout.write((Date.now() - now + 'ms').green.bold);
        process.stdout.write('\n');
    }

    var LRServer, LRTimer;
    function reload(){
        if(LRServer && LRServer.connections) {
            fis.util.map(LRServer.connections, function(id, connection){
                try {
                    connection.send({
                        command: 'reload',
                        path: '*',
                        liveCSS: true
                    });
                } catch (e) {
                    try {
                        connection.close();
                    } catch (e) {}
                    delete LRServer.connections[id];
                }
            });
        }
    }

    var lastModified = {};
    var collection = {};
    var deploy = require('./lib/deploy.js');
    var domainDefined ={
        "version": "",
        "to": "../output/app"
    };
    var domainVersion;
    var root;

    deploy.done = function(){
        clearTimeout(LRTimer);
        LRTimer = setTimeout(reload, 200);
    };

    function release(opt){
        var flag, cost, start = Date.now();
        process.stdout.write('\n Ω '.green.bold);
        opt.beforeEach = function(){
            flag = opt.verbose ? '' : '-'.bold.red;
            cost = (new Date).getTime();
        };
        opt.afterEach = function(file){
            //cal compile time
            cost = (new Date).getTime() - cost;
            if(cost > 200){
                flag = flag.bold.yellow;
                fis.log.debug(file.realpath);
            } else if(cost < 100){
                flag = flag.grey;
            }
            var mtime = file.getMtime().getTime();
            //collect file to deploy
            if(file.release && lastModified[file.subpath] !== mtime){
                if(!collection[file.subpath]){
                    process.stdout.write(flag);
                }
                lastModified[file.subpath] = mtime;
                collection[file.subpath] = file;
            }
        };

        opt.beforeCompile = function(file){
            collection[file.subpath] = file;
            process.stdout.write(flag);
        };
        try {
            //release
            var _release = require("./lib/release.js");
            _release(opt, function(ret){
                var resArr = fis.config.get("releaseResArr");
                process.stdout.write(
                    (opt.verbose ? '' : ' ') +
                    (Date.now() - start + 'ms').bold.green + '\n'
                );
                fis.log.notice("编译完成\n");
                if(domainDefined){
                    fis.log.notice("当前版本号为  "+(domainDefined["version"]||"空").bold.green+"\n");
                    if(domainDefined.js||domainDefined.common){
                        fis.log.notice("当前脚本域名为  "+(domainDefined["js"]||domainDefined["common"]).bold.green);
                    }

                    var toPath = domainDefined["to"];
                    if(toPath && toPath.indexOf(":")===-1){
                        toPath = fis.util.realpath(toPath);
                    }
                    if(toPath){
                        fis.log.notice("当前编译代码的路径为  "+toPath.bold.green);
                    }

                }
                for(var item in collection){
                    if(collection.hasOwnProperty(item)){
                        if(opt.unique){
                            time(fis.compile.clean);
                        }
                        deploy(opt, collection);
                        deploy(opt, ret.pkg);
                        collection = {};
                        return;
                    }
                }
            });
        } catch(e) {
            process.stdout.write('\n [ERROR] ' + (e.message || e) + '\n');
            if(opt.watch){
                process.stdout.write('\u0007');
            } else if(opt.verbose) {
                throw e;
            } else {
                process.exit(1);
            }
        }
    }
    var thisPath = fis.util.realpath(process.cwd()),
        filename = "tch-conf.js",
        confFilePath = thisPath+"/"+filename,
        cwd = thisPath,pos = cwd.length;
    do {
        cwd  = cwd.substring(0, pos);
        if(fis.util.exists(confFilePath)){
            root = cwd;
            break;
        } else {
            confFilePath = false;
            pos = cwd.lastIndexOf('/');
        }
    } while(pos > 0);
    if(!confFilePath){
        fis.log.error("当前目录不存在tch-conf配置文件,请进入对应的子目录下进行构建操作!");
        return;
    }
    require(confFilePath);
    commander.opts = this.commands();
    commander
        .option('-d, --dest <names>', 'release output destination', String, fis.config.get('server.dest', "./output"))
        .option('-m, --md5 [level]', 'md5 release option', Number)
        .option('-D, --domains', 'add domain name', Boolean, false)
        .option('-l, --lint', 'with lint', Boolean, false)
        .option('-t, --test', 'with unit testing', Boolean, false)
        .option('-o, --optimize', 'with optimizing', Boolean, false)
        .option('-p, --pack', 'with package', Boolean, true)
        .option('-w, --watch', 'monitor the changes of project')
        .option('-L, --live', 'automatically reload your browser')
        .option('-v, --version <version>', '设置编译版本',String)
        .option('-c, --clean', 'clean compile cache', Boolean, false)
        .option('-r, --root <path>', 'set project root',fis.config.get('server.root', "."))
        .option('-e, --verbose', 'enable verbose output', Boolean, false)
        .action(function() {
            var args = arguments,
                Command = args[args.length - 1];
            var exec = require('child_process').exec;
            if(typeof args[0] !== "string"){
                _action.apply(this,args);
                return;
            }
            exec("git branch",function(err, stdout, stderr, cb){
                var reg = /\*\s+([^\s]*\w+)\/((?:\d+\.*){3})/,
                    match = stdout.match(reg),
                    branchOut = stdout;
                exec("git diff --name-only master",function(err, stdout, stderr, cb){
                    var fileArr = stdout.split("\n");
                    var imgArr = [],resArr = [];
                    for(var i = 0, len = fileArr.length -1; i<=len;i++){
                        if(/app\/assets\/images\//.exec(fileArr[i])){
                            imgArr.push(fileArr[i]);
                        }else{
                            resArr.push(fileArr[i]);
                        }
                    }
                    fis.config.set("releaseImgArr",imgArr);
                    fis.config.set("releaseResArr",resArr);
                    if (!match) {
                        if(branchOut.match(/\*\s((weixin|wanle)\/develop|develop)/)){
                            domainVersion = "0.0.0/";
                            _action.apply(this,args);
                            return;
                        }
                        if(branchOut.match(/\*\s+master/)){
                            if(typeof Command.version === "string"){
                                domainVersion = Command.version+"/";
                                _action.apply(this,args);
                                return;
                            }
                        }
                        return fis.log.error('当前分支为 master 或者名字不合法(abc/x.y.z)，请切换分支');
                    }
                    domainVersion = match[2]+"/";
                    _action.apply(this,args);
                });

            })

        });
    function _action(){
        var arg0 = arguments[0];
        var options = arguments[arguments.length - 1];
        var cfg = commander.opts[arg0];
        var releaseCfg = fis.config.get("settings.command.release"),
            releaseDefaultCfg = releaseCfg.default,
            roadPath = fis.config.get("roadmap.path");
        if(releaseCfg && typeof arg0 === "string"){
            var domainCfg = releaseCfg.domain,
                publishCfg;
                domainDefined = domainCfg[arg0]||releaseDefaultCfg||domainDefined,
                publishCfg = domainCfg["publish"];
            if(!cfg){
                cfg = commander.opts["alone"];
            }

        }else{
            domainDefined = releaseDefaultCfg||domainDefined;
            if(!domainVersion){
                domainVersion = "";
            }
        }
        for(var i = 0, len = roadPath.length -1; i<=len; i++){
            var domainStr = roadPath[i].domain;
            if(domainStr){
                if(!domainDefined["version"]){
                    roadPath[i].version = domainDefined["version"] = domainVersion;
                }
                if(releaseCfg && typeof arg0 === "string"){
                    roadPath[i].domain = domainStr.replace(/{{(\w+)}}/g,function($0,$1){
                        return domainDefined[$1]||domainDefined["common"]||(publishCfg[$1]);
                    })
                }
                roadPath[i].release = roadPath[i].release.replace(/{{(\w+)}}/g,function($0,$1){
                    if(domainDefined.version ===null){
                        return domainVersion||"";
                    }
                    return domainDefined.version;

                })
            }
        }

        options.dest = {
            to: domainDefined.to
        };
        if(cfg){
            for(var i in cfg){
                if(i=== "desc") continue;
                options[i] = cfg[i];
            }
        }

        fis.log.throw = true;
        //configure log
        if(options.verbose){
            fis.log.level = fis.log.L_ALL;
        }
        var conf;
        if(options.file){
            if(fis.util.isFile(options.file)){
                conf = fis.util.realpath(options.file);
            } else {
                fis.log.error('invalid fis config file path [' + options.file + ']');
            }
        }
        if(options.root){
            root = fis.util.realpath(options.root);
        } else {
            root = fis.util.realpath(process.cwd());
        }

        //init project
        fis.project.setProjectRoot(root);
        process.title = 'fis ' + process.argv.splice(2).join(' ') + ' [ ' + root + ' ]';

        if(options.clean){
            time(function(){
                fis.cache.clean('compile');
            });
        }
        delete options.clean;

        //domain, fuck EventEmitter
        if(options.domains){
            options.domain = true;
            delete options.domains;
        }

        if(options.live){
            var LiveReloadServer = require('livereload-server-spec');
            var port = fis.config.get('livereload.port', 8132);
            LRServer = new LiveReloadServer({
                id: 'com.baidu.fis',
                name: 'fis-reload',
                version : fis.cli.info.version,
                port : port,
                protocols: {
                    monitoring: 7
                }
            });
            LRServer.on('livereload.js', function(req, res) {
                var script = fis.util.fs.readFileSync(__dirname + '/vendor/livereload.js');
                res.writeHead(200, {
                    'Content-Length': script.length,
                    'Content-Type': 'text/javascript',
                    'Connection': 'close'
                });
                res.end(script);
            });
            LRServer.listen(function(err) {
                if (err) {
                    err.message = 'LiveReload server Listening failed: ' + err.message;
                    fis.log.error(err);
                }
            });
            process.stdout.write('\n Ψ '.bold.yellow + port + '\n');
            ////fix mac livereload
            //process.on('uncaughtException', function (err) {
            //    if(err.message !== 'read ECONNRESET') throw  err;
            //});
            //delete options.live;
        }
        //console.log(fis.config);
        switch (typeof options.md5){
            case 'undefined':
                options.md5 = 0;
                break;
            case 'boolean':
                options.md5 = options.md5 ? 1 : 0;
                break;
            default :
                options.md5 = isNaN(options.md5) ? 0 : parseInt(options.md5);
        }
        //md5 > 0, force release hash file
        options.hash = options.md5 > 0;
        if(options.watch){
            watch(options);
        } else {
            release(options);
        }
    }
};

exports.commands = function(){
    var opts = {
        "publish": {
            "domains": true,
            "optimize": true,
            "pack": true,
            "desc": "预发模式：域名更新、代码压缩、图片合并",
            "md5": 2,
            "clean": true
        },
        "assets": {
            "pack": true,
            "desc": "本地编译，并打包"
        },
        "dev": {
            "live": true,
            "watch": true,
            "desc":"开发模式，自动编译，自动更新浏览器"
        },
        "alone":{
            "domains": true,
            "pack": true,
            "desc": "独立部署模式：域名更新、图片合并",
            "md5": 2
        }
    };
    return opts;
}
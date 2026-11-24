<?php
declare(strict_types=1);
session_start();
header('Content-Type: application/json; charset=utf-8');

$host = 'localhost';
$db   = 'bookstoriaga';
$user = 'root';
$pass = ''; 

function respond($data = null, int $status = 200): never {
    http_response_code($status);
    echo json_encode(['success' => $status < 400, 'data' => $data,
        'message' => $status >= 400 ? (string)$data : null],
        JSON_UNESCAPED_UNICODE);
    exit;
}
function db(): PDO {
    global $host,$db,$user,$pass;
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4",$user,$pass,[
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC
    ]);
    return $pdo;
}
function input(): array {
    $raw=file_get_contents('php://input');
    $data=json_decode($raw ?: '{}',true);
    return is_array($data) ? $data : [];
}
function saveBookCoverUpload(): ?string {
    global $uploadedCoverPath;
    if (!isset($_FILES['coverImage']) || $_FILES['coverImage']['error'] === UPLOAD_ERR_NO_FILE) return null;
    $file=$_FILES['coverImage'];
    if ($file['error'] !== UPLOAD_ERR_OK) respond('The cover image could not be uploaded.',422);
    if ((int)$file['size'] > 5 * 1024 * 1024) respond('Cover images must be no larger than 5 MB.',422);
    if (!is_uploaded_file($file['tmp_name'])) respond('Invalid cover image upload.',422);

    $imageInfo=@getimagesize($file['tmp_name']);
    $extensions=['image/jpeg'=>'.jpg','image/png'=>'.png','image/webp'=>'.webp'];
    $mime=$imageInfo['mime'] ?? '';
    if (!$imageInfo || !isset($extensions[$mime])) {
        respond('Choose a valid JPG, PNG, or WebP image.',422);
    }

    $directory=__DIR__.DIRECTORY_SEPARATOR.'uploads'.DIRECTORY_SEPARATOR.'book-covers';
    if (!is_dir($directory) && !mkdir($directory,0755,true) && !is_dir($directory)) {
        respond('The cover image folder could not be created.',500);
    }
    $filename=bin2hex(random_bytes(16)).$extensions[$mime];
    $uploadedCoverPath=$directory.DIRECTORY_SEPARATOR.$filename;
    if (!move_uploaded_file($file['tmp_name'],$uploadedCoverPath)) {
        $uploadedCoverPath=null;
        respond('The cover image could not be saved.',500);
    }
    return 'uploads/book-covers/'.$filename;
}
function requireLogin(): void {
    if (empty($_SESSION['user'])) respond('Please sign in again.',401);
}
function logAction(string $actor,string $action,string $target,string $details): void {
    $q=db()->prepare('INSERT INTO audit_logs(actor,action,target,details) VALUES(?,?,?,?)');
    $q->execute([$actor,$action,$target,$details]);
}
function userPublic(array $u): array {
    return ['id'=>(string)$u['user_id'],'name'=>$u['full_name'],'email'=>$u['email'],
        'role'=>$u['role'],'active'=>(bool)$u['active']];
}
function getItemRows(): array {
    $rows=db()->query('SELECT * FROM inventory_items ORDER BY item_id DESC')->fetchAll();
    foreach($rows as &$r) {
        $r=['id'=>(string)$r['item_id'],'sku'=>$r['sku'],'title'=>$r['title'],'author'=>$r['author'],
            'coverUrl'=>$r['cover_url'],'description'=>$r['description'],'tags'=>json_decode($r['tags'] ?: '[]',true),
            'supplierId'=>$r['supplier_id'] === null ? '' : (string)$r['supplier_id'],
            'costPrice'=>(float)$r['cost_price'],'sellPrice'=>(float)$r['sell_price'],
            'stock'=>(int)$r['stock'],'lowThreshold'=>(int)$r['low_threshold']];
    }
    return $rows;
}
function getSupplierRows(): array {
    $rows=db()->query('SELECT * FROM suppliers ORDER BY supplier_id DESC')->fetchAll();
    foreach($rows as &$r) $r=['id'=>(string)$r['supplier_id'],'name'=>$r['name'],'contact'=>$r['contact'],
        'phone'=>$r['phone'],'email'=>$r['email'],'leadDays'=>(int)$r['lead_days'],
        'tags'=>json_decode($r['tags'] ?: '[]',true)];
    return $rows;
}
function getTransactions(): array {
    $rows=db()->query('SELECT * FROM transactions ORDER BY transaction_id')->fetchAll();
    foreach($rows as &$r) $r=['id'=>(string)$r['transaction_id'],'type'=>$r['type'],
        'itemId'=>(string)$r['item_id'],'qty'=>(int)$r['qty'],'unitPrice'=>(float)$r['unit_price'],
        'unitCost'=>(float)$r['unit_cost'],'timestamp'=>(strtotime((string)$r['created_at']) ?: 0) * 1000];
    return $rows;
}
$uploadedCoverPath=null;
try {
    $in=$_POST ?: input();
    if (isset($in['itemData']) && is_string($in['itemData'])) {
        $itemData=json_decode($in['itemData'],true);
        if (!is_array($itemData)) respond('Invalid book information.',422);
        $in['itemData']=$itemData;
    }
    $action=$in['action'] ?? '';
    $pdo=db();

    if ($action==='login') {
        $q=$pdo->prepare('SELECT * FROM users WHERE email=? LIMIT 1'); $q->execute([trim($in['email']??'')]);
        $u=$q->fetch();
        if (!$u || !password_verify((string)($in['password']??''),$u['password_hash'])) respond('Invalid email or password.',401);
        if (!(bool)$u['active']) respond('This account is deactivated. Contact the shop Owner.',403);
        $_SESSION['user']=userPublic($u);
        logAction($u['full_name'].' ('.$u['role'].')','USER_LOGIN',$u['email'],'Signed into workspace');
        respond($_SESSION['user']);
    }
    if ($action==='verify_reset_email') {
        $q=$pdo->prepare('SELECT email FROM users WHERE email=?'); $q->execute([trim($in['email']??'')]);
        $email=$q->fetchColumn(); if(!$email) respond('No account found with that email address.',404);
        respond($email);
    }
    if ($action==='reset_password') {
        $email=trim($in['email']??''); $new=(string)($in['newPassword']??'');
        if(strlen($new)<6) respond('Password must be at least 6 characters.',422);
        $q=$pdo->prepare('UPDATE users SET password_hash=? WHERE email=?');
        $q->execute([password_hash($new,PASSWORD_DEFAULT),$email]);
        if(!$q->rowCount()) respond('Account not found.',404);
        logAction($email,'PASSWORD_RESET',$email,'Completed password recovery');
        respond(true);
    }
    if ($action==='logout') {
        if(!empty($_SESSION['user'])) {
            $u=$_SESSION['user']; logAction($u['name'].' ('.$u['role'].')','USER_LOGOUT',$u['email'],'Signed out');
        }
        $_SESSION=[]; session_destroy(); respond(true);
    }
    requireLogin();
    $actorUser=$_SESSION['user'];
    $actor=$in['actor'] ?? ($actorUser['name'].' ('.$actorUser['role'].')');

    switch($action) {
        case 'change_password':
            $q=$pdo->prepare('SELECT password_hash FROM users WHERE user_id=?'); $q->execute([$actorUser['id']]); $hash=$q->fetchColumn();
            if(!$hash || !password_verify((string)$in['currentPassword'],$hash)) respond('Current password is incorrect.',422);
            $pdo->prepare('UPDATE users SET password_hash=? WHERE user_id=?')->execute([password_hash((string)$in['newPassword'],PASSWORD_DEFAULT),$actorUser['id']]);
            logAction($actor,'PASSWORD_CHANGED',$actorUser['email'],'Updated account password in Settings'); respond(true);

        case 'update_profile':
            $name=trim((string)$in['newName']); if($name==='') respond('Display name cannot be empty.',422);
            $pdo->prepare('UPDATE users SET full_name=? WHERE user_id=?')->execute([$name,$actorUser['id']]);
            $_SESSION['user']['name']=$name; logAction($actor,'PROFILE_UPDATED',$actorUser['email'],'Updated display name');
            respond($_SESSION['user']);

        case 'get_inventory':
            $tags=$pdo->query('SELECT name FROM categories ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
            respond(['items'=>getItemRows(),'tags'=>$tags,'suppliers'=>getSupplierRows(),'transactions'=>getTransactions()]);

        case 'save_inventory_item':
            $d=$in['itemData']; $tags=json_encode($d['tags']??[]);
            $coverUrl=saveBookCoverUpload() ?? ($d['coverUrl']??'');
            if(!empty($d['id'])) {
                $q=$pdo->prepare('UPDATE inventory_items SET sku=?,title=?,author=?,cover_url=?,description=?,tags=?,supplier_id=?,cost_price=?,sell_price=?,low_threshold=? WHERE item_id=?');
                $q->execute([$d['sku'],$d['title'],$d['author']??'',$coverUrl,$d['description']??'',$tags,($d['supplierId']??'')?:null,$d['costPrice'],$d['sellPrice'],$d['lowThreshold']??0,$d['id']]);
                $uploadedCoverPath=null;
                logAction($actor,'BOOK_UPDATED',$d['title'],'Updated book information & pricing');
            } else {
                $q=$pdo->prepare('INSERT INTO inventory_items(sku,title,author,cover_url,description,tags,supplier_id,cost_price,sell_price,stock,low_threshold) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
                $q->execute([$d['sku'],$d['title'],$d['author']??'',$coverUrl,$d['description']??'',$tags,($d['supplierId']??'')?:null,$d['costPrice'],$d['sellPrice'],$d['stock']??0,$d['lowThreshold']??0]);
                $uploadedCoverPath=null;
                logAction($actor,'BOOK_CREATED',$d['title'],'Added SKU '.$d['sku']);
            } respond(getItemRows());

        case 'delete_inventory_item':
            $itemId = (int)($in['itemId'] ?? 0);
            if ($itemId <= 0) {
                respond('Invalid book ID.', 422);
            }
            $q = $pdo->prepare(
            'SELECT title, sku FROM inventory_items WHERE item_id = ?'
            );
            $q->execute([$itemId]);
            $old = $q->fetch();
            if (!$old) {
                respond('Book not found. It may have already been deleted.', 404);
            } try {
                $pdo->beginTransaction();
                $pdo->prepare(
                'DELETE FROM transactions WHERE item_id = ?'
                )->execute([$itemId]);
                $delete = $pdo->prepare('DELETE FROM inventory_items WHERE item_id = ?');
                $delete->execute([$itemId]);
                if ($delete->rowCount() === 0) {
                    throw new RuntimeException('The book could not be deleted.');
                }
                logAction($actor,'BOOK_DELETED',$old['title'],'Removed SKU ' . $old['sku']);
                $pdo->commit();
                respond(getItemRows());
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                $pdo->rollBack();}
                throw $e;
            }

        case 'manage_tags':
            $a=$in['tagAction']; $p=$in['payload']??[];
            if($a==='ADD') {
                $name=trim($p['name']??''); if($name==='') respond('Tag name cannot be empty.',422);
                try{$pdo->prepare('INSERT INTO categories(name) VALUES(?)')->execute([$name]);}catch(PDOException $e){respond('Tag already exists.',409);}
                logAction($actor,'TAG_CREATED',$name,'Added new category tag');
            } elseif($a==='RENAME') {
                $old=$p['oldName']; $new=trim($p['newName']); if($new==='') respond('Tag name cannot be empty.',422);
                $pdo->prepare('UPDATE categories SET name=? WHERE name=?')->execute([$new,$old]);
                $items=getItemRows(); foreach($items as $it){$t=array_map(fn($x)=>$x===$old?$new:$x,$it['tags']); if($t!==$it['tags']) $pdo->prepare('UPDATE inventory_items SET tags=? WHERE item_id=?')->execute([json_encode($t),$it['id']]);}
                foreach(getSupplierRows() as $s){$t=array_map(fn($x)=>$x===$old?$new:$x,$s['tags']); if($t!==$s['tags']) $pdo->prepare('UPDATE suppliers SET tags=? WHERE supplier_id=?')->execute([json_encode($t),$s['id']]);}
                logAction($actor,'TAG_RENAMED',$old.' to '.$new,'Renamed tag');
            } elseif($a==='DELETE') {
                $name=$p['name']; $pdo->prepare('DELETE FROM categories WHERE name=?')->execute([$name]);
                foreach(getItemRows() as $it){$t=array_values(array_filter($it['tags'],fn($x)=>$x!==$name)); if($t!==$it['tags']) $pdo->prepare('UPDATE inventory_items SET tags=? WHERE item_id=?')->execute([json_encode($t),$it['id']]);}
                foreach(getSupplierRows() as $s){$t=array_values(array_filter($s['tags'],fn($x)=>$x!==$name)); if($t!==$s['tags']) $pdo->prepare('UPDATE suppliers SET tags=? WHERE supplier_id=?')->execute([json_encode($t),$s['id']]);}
                logAction($actor,'TAG_DELETED',$name,'Deleted tag from system');
            }
            respond($pdo->query('SELECT name FROM categories ORDER BY name')->fetchAll(PDO::FETCH_COLUMN));

        case 'save_supplier':
            $d=$in['supData']; if(!empty($d['id'])) {
                $q=$pdo->prepare('UPDATE suppliers SET name=?,contact=?,phone=?,email=?,lead_days=?,tags=? WHERE supplier_id=?');
                $q->execute([$d['name'],$d['contact']??'',$d['phone']??'',$d['email']??'',$d['leadDays']??0,json_encode($d['tags']??[]),$d['id']]);
                logAction($actor,'SUPPLIER_UPDATED',$d['name'],'Updated supplier');
            } else {
                $q=$pdo->prepare('INSERT INTO suppliers(name,contact,phone,email,lead_days,tags) VALUES(?,?,?,?,?,?)');
                $q->execute([$d['name'],$d['contact']??'',$d['phone']??'',$d['email']??'',$d['leadDays']??0,json_encode($d['tags']??[])]);
                logAction($actor,'SUPPLIER_CREATED',$d['name'],'Added supplier');
            } respond(getSupplierRows());

        case 'delete_supplier':
            $supplierId = (int)($in['supplierId'] ?? 0);
            if ($supplierId <= 0) respond('Invalid supplier ID.',422);

            $q = $pdo->prepare('SELECT name FROM suppliers WHERE supplier_id = ?');
            $q->execute([$supplierId]);
            $supplier = $q->fetch();
            if (!$supplier) respond('Supplier not found. It may have already been deleted.',404);

            try {
                $pdo->beginTransaction();

                // Keep inventory records intact while removing their supplier link.
                $unlink = $pdo->prepare('UPDATE inventory_items SET supplier_id = NULL WHERE supplier_id = ?');
                $unlink->execute([$supplierId]);
                $unassignedCount = $unlink->rowCount();

                $delete = $pdo->prepare('DELETE FROM suppliers WHERE supplier_id = ?');
                $delete->execute([$supplierId]);
                if ($delete->rowCount() === 0) {
                    throw new RuntimeException('The supplier could not be deleted.');
                }

                logAction($actor,'SUPPLIER_DELETED',$supplier['name'],
                    'Deleted supplier and unassigned '.$unassignedCount.' book(s)');
                $pdo->commit();
                respond(['suppliers'=>getSupplierRows(),'unassignedItems'=>$unassignedCount]);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

        case 'submit_transaction':
            $p=$in['payload']; $mode=$p['mode']; $cart=$p['cartItems']??[];
            if(!in_array($mode,['SELL','RESTOCK'],true) || !$cart) respond('Please add at least one item.',422);
            $pdo->beginTransaction(); $total=0; $summary=[];
            foreach($cart as $entry) {
                $q=$pdo->prepare('SELECT * FROM inventory_items WHERE item_id=? FOR UPDATE'); $q->execute([$entry['itemId']]); $it=$q->fetch();
                $qty=(int)$entry['qty']; if(!$it || $qty<1 || ($mode==='SELL' && $it['stock']<$qty)) { $pdo->rollBack(); respond('Insufficient stock or invalid quantity.',422); }
                $unit=$mode==='SELL'?(float)$it['sell_price']:(float)$it['cost_price']; $total += $unit*$qty;
                $newStock=(int)$it['stock']+($mode==='SELL'?-$qty:$qty);
                $pdo->prepare('UPDATE inventory_items SET stock=? WHERE item_id=?')->execute([$newStock,$it['item_id']]);
                $pdo->prepare('INSERT INTO transactions(type,item_id,qty,unit_price,unit_cost) VALUES(?,?,?,?,?)')->execute([$mode,$it['item_id'],$qty,$it['sell_price'],$it['cost_price']]);
                $summary[]=$qty.'x '.$it['title'];
            }
            $pdo->commit(); $receipt=($mode==='SELL'?'POS':'RST').'-'.substr((string)time(),-5);
            logAction($actor,$mode==='SELL'?'SALE_COMPLETED':'RESTOCK_COMPLETED','Receipt #'.$receipt,implode(', ',$summary).' (Total: PHP '.number_format($total,2).')');
            respond(['receiptRef'=>$receipt,'grandTotal'=>$total]);
            
        case 'manage_users':
            if($actorUser['role']!=='Owner') respond('Owner access required.',403);
            $ua=$in['userAction']; $p=$in['payload']??[];
            if($ua==='LIST') {
                $rows=$pdo->query('SELECT * FROM users ORDER BY user_id')->fetchAll(); respond(array_map('userPublic',$rows));
            }
            if($ua==='SAVE') {
                if(!empty($p['id'])) {
                    $pdo->prepare('UPDATE users SET full_name=?,email=?,role=? WHERE user_id=?')->execute([$p['name'],$p['email'],$p['role'],$p['id']]);
                    logAction($actor,'USER_UPDATED',$p['email'],'Updated role to '.$p['role']);
                } else {
                    $q=$pdo->prepare('INSERT INTO users(full_name,email,password_hash,role,active) VALUES(?,?,?,?,1)');
                    try{$q->execute([$p['name'],$p['email'],password_hash($p['password']??'password123',PASSWORD_DEFAULT),$p['role']]);}
                    catch(PDOException $e){respond('A user with this email already exists.',409);}
                    logAction($actor,'USER_CREATED',$p['email'],'Created account for '.$p['name']);
                }
            } elseif($ua==='TOGGLE_ACTIVE') {
                $pdo->prepare('UPDATE users SET active=NOT active WHERE user_id=?')->execute([$p['id']]);
                logAction($actor,'USER_STATUS_CHANGED',(string)$p['id'],'Changed account active status');
            } elseif($ua==='RESET_PASS') {
                $pdo->prepare('UPDATE users SET password_hash=? WHERE user_id=?')->execute([password_hash($p['newPassword'],PASSWORD_DEFAULT),$p['id']]);
                logAction($actor,'ADMIN_PASSWORD_RESET',(string)$p['id'],'Owner reset account password');
            }
            $rows=$pdo->query('SELECT * FROM users ORDER BY user_id')->fetchAll(); respond(array_map('userPublic',$rows));
        case 'get_logs':
            if($actorUser['role']!=='Owner') respond('Owner access required.',403);
            $rows=$pdo->query('SELECT * FROM audit_logs ORDER BY log_id DESC')->fetchAll();
            $out=[]; foreach($rows as $r) $out[]=['id'=>(string)$r['log_id'],'timestamp'=>$r['created_at'],'user'=>$r['actor'],'action'=>$r['action'],'target'=>$r['target'],'details'=>$r['details']];
            respond($out);
        default: respond('Unknown API action.',400);
    }
} catch(Throwable $e) {
    if(isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    if($uploadedCoverPath && is_file($uploadedCoverPath) && !unlink($uploadedCoverPath)) {
        error_log('Unable to remove an unreferenced uploaded cover image.');
    }
    error_log($e->getMessage());
    respond('Server/database error. Check your PHP and MySQL configuration.',500);
}

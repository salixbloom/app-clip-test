"""Generate the self-contained native test host + App Clip Xcode project. No SDK required."""
from pathlib import Path
import hashlib
import plistlib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2] / 'native'
OBJECTS = {}
class Ref(str):
    pass

def uid(name):
    return Ref(hashlib.sha256(name.encode()).hexdigest()[:24].upper())

def obj(identifier, isa, **fields):
    key = uid(identifier)
    OBJECTS[key] = dict(isa=isa, **fields)
    return key

def serial(value, level=0):
    if isinstance(value, Ref):
        return str(value)
    if isinstance(value, str):
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    if isinstance(value, dict):
        return '{\n' + ''.join('\t'*(level+1) + serial(k) + ' = ' + serial(v, level+1) + ';\n' for k,v in value.items()) + '\t'*level + '}'
    if isinstance(value, list):
        return '(' + ', '.join(serial(v,level+1) for v in value) + ')'
    return str(value)

project = uid('project')
root_group = uid('root-group')
products = uid('products')
source_refs=[]
for file,kind in [('ARKitCaptureController.swift','sourcecode.swift'),('CaptureScreen.swift','sourcecode.swift'),('Resources/GuidedNative.js','sourcecode.javascript')]:
    source_refs.append(obj(file,'PBXFileReference',lastKnownFileType=kind,path='GuidedCapture/'+file,sourceTree='<group>'))
product_refs={name:obj(name+'-product','PBXFileReference',explicitFileType='wrapper.application',includeInIndex=0,path=name+'.app',sourceTree='BUILT_PRODUCTS_DIR') for name in ['CaptureHost','CaptureClip']}
obj('products','PBXGroup',children=list(product_refs.values()),name='Products',sourceTree='<group>')
obj('root-group','PBXGroup',children=source_refs+[products],sourceTree='<group>')

# Info and entitlements are deterministic, inspectable XML property lists.
for name in ['CaptureHost','CaptureClip']:
    info={'CFBundleDevelopmentRegion':'en','CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'$(PRODUCT_NAME)','CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','CFBundleVersion':'1','LSRequiresIPhoneOS':True,'NSCameraUsageDescription':'Capture a stationary subject with matched camera positions for a local reconstruction test.','UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait'],'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False}}
    if name=='CaptureClip':
        info['NSAppClip']={'NSAppClipRequestEphemeralUserNotification':False,'NSAppClipRequestLocationConfirmation':False}
        ent={'com.apple.developer.parent-application-identifiers':['$(AppIdentifierPrefix)com.example.FFSCapture']}
    else:
        ent={'com.apple.developer.associated-appclip-app-identifiers':['$(AppIdentifierPrefix)com.example.FFSCapture.Clip']}
    for suffix,data in [('-Info.plist',info),('.entitlements',ent)]:
        (ROOT/'GuidedCapture'/(name+suffix)).write_bytes(plistlib.dumps(data,sort_keys=True))

def configs(name, settings):
    ids=[]
    for mode in ['Debug','Release']:
        fields={**settings,'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O'}
        ids.append(obj(name+'-'+mode,'XCBuildConfiguration',buildSettings=fields,name=mode))
    return obj(name+'-configs','XCConfigurationList',buildConfigurations=ids,defaultConfigurationIsVisible=0,defaultConfigurationName='Release')

common={'SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'16.0','SWIFT_VERSION':'5.0','CLANG_ENABLE_MODULES':'YES','SWIFT_STRICT_CONCURRENCY':'minimal','TARGETED_DEVICE_FAMILY':'1','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','CODE_SIGN_STYLE':'Automatic','ENABLE_BITCODE':'NO','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']}
proj_configs=configs('project',common)
for name in ['CaptureHost','CaptureClip']:
    build_files=[obj(name+'-'+str(i),'PBXBuildFile',fileRef=r) for i,r in enumerate(source_refs)]
    phases=[obj(name+'-sources','PBXSourcesBuildPhase',buildActionMask=2147483647,files=build_files[:2],runOnlyForDeploymentPostprocessing=0),obj(name+'-frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0),obj(name+'-resources','PBXResourcesBuildPhase',buildActionMask=2147483647,files=build_files[2:],runOnlyForDeploymentPostprocessing=0)]
    dependencies=[]
    if name=='CaptureHost':
        embed=obj('embed-clip-file','PBXBuildFile',fileRef=product_refs['CaptureClip'],settings={'ATTRIBUTES':['RemoveHeadersOnCopy']})
        phases.append(obj('embed-clips','PBXCopyFilesBuildPhase',buildActionMask=2147483647,dstPath='$(CONTENTS_FOLDER_PATH)/AppClips',dstSubfolderSpec=16,files=[embed],name='Embed App Clips',runOnlyForDeploymentPostprocessing=0))
        proxy=obj('clip-proxy','PBXContainerItemProxy',containerPortal=project,proxyType=1,remoteGlobalIDString=uid('CaptureClip-target'),remoteInfo='CaptureClip')
        dependencies.append(obj('clip-dependency','PBXTargetDependency',target=uid('CaptureClip-target'),targetProxy=proxy))
    settings={'PRODUCT_NAME':name,'PRODUCT_BUNDLE_IDENTIFIER':'com.example.FFSCapture'+('.Clip' if name=='CaptureClip' else ''),'INFOPLIST_FILE':'GuidedCapture/'+name+'-Info.plist','CODE_SIGN_ENTITLEMENTS':'GuidedCapture/'+name+'.entitlements','GENERATE_INFOPLIST_FILE':'NO','INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','SKIP_INSTALL':'YES' if name=='CaptureClip' else 'NO'}
    obj(name+'-target','PBXNativeTarget',buildConfigurationList=configs(name,settings),buildPhases=phases,buildRules=[],dependencies=dependencies,name=name,productName=name,productReference=product_refs[name],productType='com.apple.product-type.application.on-demand-install-capable' if name=='CaptureClip' else 'com.apple.product-type.application')
obj('project','PBXProject',attributes={'BuildIndependentTargetsInParallel':'YES','LastUpgradeCheck':'1600'},buildConfigurationList=proj_configs,compatibilityVersion='Xcode 14.0',developmentRegion='en',hasScannedForEncodings=0,knownRegions=['en','Base'],mainGroup=root_group,productRefGroup=products,projectDirPath='',projectRoot='',targets=[uid('CaptureHost-target'),uid('CaptureClip-target')])

out=ROOT/'GuidedCaptureDevice.xcodeproj'
out.mkdir(exist_ok=True)
(out/'project.pbxproj').write_text('// !$*UTF8*$!\n'+serial({'archiveVersion':1,'classes':{},'objectVersion':56,'objects':OBJECTS,'rootObject':project})+'\n')
schemes=out/'xcshareddata/xcschemes';schemes.mkdir(parents=True,exist_ok=True)
for name in ['CaptureHost','CaptureClip']:
    scheme=ET.Element('Scheme',LastUpgradeVersion='1600',version='1.3')
    build=ET.SubElement(scheme,'BuildAction',parallelizeBuildables='YES',buildImplicitDependencies='YES')
    entries=ET.SubElement(build,'BuildActionEntries')
    entry=ET.SubElement(entries,'BuildActionEntry',buildForTesting='YES',buildForRunning='YES',buildForProfiling='YES',buildForArchiving='YES',buildForAnalyzing='YES')
    def reference(parent):
        ET.SubElement(parent,'BuildableReference',BuildableIdentifier='primary',BlueprintIdentifier=uid(name+'-target'),BuildableName=name+'.app',BlueprintName=name,ReferencedContainer='container:GuidedCaptureDevice.xcodeproj')
    reference(entry)
    launch=ET.SubElement(scheme,'LaunchAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',launchStyle='0',useCustomWorkingDirectory='NO',ignoresPersistentStateOnLaunch='NO',debugDocumentVersioning='YES',debugServiceExtension='internal',allowLocationSimulation='YES')
    runnable=ET.SubElement(launch,'BuildableProductRunnable',runnableDebuggingMode='0');reference(runnable)
    if name=='CaptureClip':
        env=ET.SubElement(launch,'EnvironmentVariables');ET.SubElement(env,'EnvironmentVariable',key='_XCAppClipURL',value='https://example.invalid/capture',isEnabled='YES')
    ET.SubElement(scheme,'AnalyzeAction',buildConfiguration='Debug')
    ET.SubElement(scheme,'ArchiveAction',buildConfiguration='Release',revealArchiveInOrganizer='YES')
    ET.indent(scheme)
    (schemes/(name+'.xcscheme')).write_bytes(ET.tostring(scheme,encoding='utf-8',xml_declaration=True))
# Structural checks: every reference resolves, source/resource paths exist.
def check(v):
    if isinstance(v,Ref):
        assert v in OBJECTS, v
    elif isinstance(v,dict):
        for x in v.values():check(x)
    elif isinstance(v,list):
        for x in v:check(x)
for item in OBJECTS.values():check(item)
for ref in source_refs:assert (ROOT/OBJECTS[ref]['path']).is_file()
for path in (ROOT/'GuidedCapture').glob('*.plist'):plistlib.loads(path.read_bytes())
print('Generated host + App Clip project; all object references, source paths and XML plists validated. Xcode compilation NOT performed.')

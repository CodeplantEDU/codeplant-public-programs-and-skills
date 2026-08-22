# CODEPLANT RDP 디스플레이 실행기

![CODEPLANT RDP 아이콘](assets/codeplant-rdp-icon-preview.png)

노트북에서 Tailscale을 통해 업무용 Windows PC의 **기존 사용자 프로필 그대로** 접속하고, 실행할 때 선택한 1개 이상의 모니터를 RDP 가상 디스플레이로 사용하는 Windows 도구입니다.

이 방식은 호스트의 실제 모니터 화면을 복제하는 화면 공유가 아닙니다. Windows 네이티브 RDP 세션이 클라이언트 모니터 배치에 맞춰 가상 디스플레이를 만듭니다. Apollo/Artemis나 RDP Shadow는 필요하지 않습니다.

## 제공 기능

- 호스트의 RDP·NLA·방화벽·그래픽 정책을 변경 전 백업하고 안전하게 설정
- Tailscale IPv4 또는 MagicDNS 이름이 들어간 개인용 Windows 실행기 생성
- 실행할 때 `mstsc.exe /l`로 RDP 모니터 목록 표시
- 단일·듀얼·3개 이상 모니터 ID 직접 선택
- CODEPLANT 앱 아이콘이 적용된 EXE 생성
- 호스트 3389 포트 연결 가능성 확인 후 Windows 원격 데스크톱 실행
- 백업 상태를 이용한 원복 스크립트 제공

## 저장소 받기

```powershell
git clone https://github.com/CodeplantEDU/codeplant-public-programs-and-skills.git
Set-Location .\codeplant-public-programs-and-skills\apps\rdp-display-launcher
```

## 요구 사항

- 호스트: Windows Pro, Enterprise 또는 Education
- 호스트와 노트북: 같은 Tailnet에 로그인된 Tailscale
- 호스트에서 사용할 기존 Windows 계정의 실제 비밀번호
- 초기 호스트 설정을 위한 관리자 권한
- 노트북의 모니터가 Windows 디스플레이 설정에서 확장 모드로 인식될 것

Windows Home은 Microsoft 네이티브 RDP 호스트를 제공하지 않습니다. RDP Wrapper나 `termsrv.dll` 패치는 사용하지 않습니다.

## 1. 호스트 설정

관리자 PowerShell에서 실행합니다.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
Set-Location .\scripts
.\Setup-RdpHost.ps1 -ValidateOnly
.\Setup-RdpHost.ps1
```

스크립트는 다음 작업을 수행합니다.

- Windows 에디션과 설치된 ADMX 정책 정의 확인
- 기존 RDP, NLA, 방화벽, 그래픽 정책 상태 백업
- RDP 호스트 활성화 및 NLA 유지
- Windows 기본 Remote Desktop TCP/UDP 인바운드 규칙 활성화
- ADMX에서 확인된 GPU, H.264 하드웨어 인코딩, AVC 4:4:4 정책 활성화
- 원복 스크립트와 상태 파일을 `C:\RDP-Setup-Backup\<timestamp>`에 저장

설정 후 호스트의 Tailscale 주소를 확인합니다.

```powershell
tailscale status
tailscale ip -4
```

## 2. 노트북용 실행 파일 만들기

먼저 **노트북에서** RDP가 부여한 실제 모니터 ID를 확인합니다. Windows 디스플레이 설정에 보이는 `1`, `2` 번호와 다를 수 있습니다.

```powershell
mstsc.exe /l
```

목록에 표시된 사용할 모니터 ID를 기록합니다. 예를 들어 `1`과 `6`이라면 `1,6`을 사용합니다. 첫 번째 ID가 원격 세션의 주 모니터가 됩니다. 실행기는 연결할 때마다 이 목록을 다시 보여주므로 모니터 구성을 바꿔 사용할 수 있습니다.

그다음 일반 PowerShell에서 호스트의 Tailscale IPv4 또는 MagicDNS 이름을 지정합니다. `DefaultMonitors`는 실행 창에 처음 표시할 기본값이며 나중에 언제든 바꿀 수 있습니다.

```powershell
Set-Location .\scripts
.\New-RdpLauncher.ps1 `
  -HostAddress '<TAILSCALE_IP_OR_MAGICDNS>' `
  -DefaultMonitors '<ID1>,<ID2>' `
  -OutputPath "$env:USERPROFILE\Desktop\CODEPLANT_RDP_Display.exe"
```

생성된 EXE를 노트북에서 실행하면 먼저 RDP 모니터 목록이 열리고, 이어서 사용할 모니터 번호 입력창이 표시됩니다. `1`, `1,6`, `1,6,7`처럼 입력할 수 있습니다. 실행기는 호스트의 3389 포트 접근 가능성을 짧게 확인한 뒤 임시 `.rdp` 파일에 다음 핵심 설정을 기록해 네이티브 RDP를 실행합니다.

```text
use multimon:i:1
selectedmonitors:s:<선택한 모니터 ID>
dynamic resolution:i:0
```

빌드 도구가 없는 PC에서는 [`examples/Work-RDP-DualMonitor.rdp.example`](examples/Work-RDP-DualMonitor.rdp.example)을 복사해 `full address`와 `selectedmonitors`를 바꾼 뒤 `.rdp` 확장자로 저장해도 됩니다.

## 3. 기존 프로필 그대로 로그인하기

로그인 이름은 이메일 대신 아래 형식을 우선 사용합니다.

```text
컴퓨터이름\기존사용자이름
```

Windows Hello PIN은 RDP 자격증명 비밀번호가 아닙니다. Microsoft 계정 로그인에서 비밀번호 인증이 계속 실패하면 **새 사용자를 만들지 말고**, Windows 설정에서 현재 계정을 로컬 계정으로 전환한 뒤 같은 사용자 이름과 새 로컬 비밀번호를 사용합니다. 이 전환은 기존 사용자 SID와 `C:\Users\<프로필>`을 유지하므로 프로그램, 바탕화면, 파일, Codex 설정을 그대로 씁니다.

## 4. 원복

설정 스크립트가 출력한 백업 폴더에서 관리자 PowerShell로 실행합니다.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
C:\RDP-Setup-Backup\<timestamp>\Restore-RdpHost.ps1
```

원복 스크립트는 적용 전 RDP, NLA, 방화벽, 그래픽 정책과 서비스 상태를 복구합니다.

## 주의 사항

- 이 저장소에는 개인 Tailscale 주소, Windows 계정, 비밀번호가 들어 있는 완성 EXE를 올리지 않습니다. 각 사용자가 `New-RdpLauncher.ps1`로 자신의 실행기를 생성해야 합니다.
- 공유기에서 공인 인터넷 방향으로 TCP 3389를 열지 않습니다.
- Windows Defender Firewall 전체를 끄지 않습니다.
- 호스트 PC가 절전 상태면 접속할 수 없습니다. 화면 꺼짐과 절전은 서로 다른 설정입니다.
- 노트북 연결 단자나 디스플레이 배치를 바꾸면 RDP 모니터 ID가 달라질 수 있습니다. 다시 `mstsc.exe /l`을 실행하고 EXE를 재생성합니다.
- 상세 오류 처리는 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)를 참고합니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `scripts/Setup-RdpHost.ps1` | 호스트 상태 백업과 RDP·NLA·방화벽·그래픽 정책 설정 |
| `scripts/Restore-RdpHost.ps1` | 백업된 호스트 상태 원복 |
| `scripts/New-RdpLauncher.ps1` | 개인 Tailscale 주소가 들어간 CODEPLANT EXE 생성 |
| `src/RdpDualMonitorLauncher.cs.template` | 모니터 선택 실행기 C# 템플릿 |
| `assets/` | CODEPLANT 실행기 아이콘과 미리보기 |
| `examples/` | 직접 수정해 사용할 수 있는 `.rdp` 예시 |
| `docs/TROUBLESHOOTING.md` | 로그인·Tailscale·모니터 문제 해결 |

## 검수

호스트 설정을 변경하지 않는 기본 검사입니다.

```powershell
.\scripts\Setup-RdpHost.ps1 -ValidateOnly
.\scripts\New-RdpLauncher.ps1 `
  -HostAddress '127.0.0.1' `
  -DefaultMonitors '1,2' `
  -OutputPath "$env:TEMP\CODEPLANT_RDP_Display_Test.exe"
```

실제 사용 가능 여부는 같은 Tailnet의 호스트에서 `Test-NetConnection <HOST> -Port 3389`가 성공하고, 클라이언트에서 실제 RDP 로그인과 선택한 모니터 표시까지 확인해야 확정할 수 있습니다.

## 라이선스

이 프로그램의 자체 작성 소스와 문서는 저장소 루트의 MIT License를 따릅니다. Microsoft 원격 데스크톱과 Tailscale은 각각 해당 제품의 이용 조건을 따릅니다.

/* Applies only to the emulator's writable copy. Never flash the result. */
#include <elf.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
static unsigned char *data;
static size_t size;
static int valid(size_t off,size_t len){return off<=size&&len<=size-off;}
static uint16_t u16(size_t o){return (uint16_t)(data[o]|data[o+1]<<8);}
static uint32_t u32(size_t o){return (uint32_t)data[o]|(uint32_t)data[o+1]<<8|(uint32_t)data[o+2]<<16|(uint32_t)data[o+3]<<24;}
static uint32_t symbol(const char *name){
    uint32_t off=u32(32);unsigned step=u16(46),n=u16(48);
    if(step<40||!valid(off,(size_t)step*n))return 0;
    for(unsigned i=0;i<n;i++){
        size_t s=off+(size_t)i*step;
        if(u32(s+4)!=SHT_DYNSYM)continue;
        uint32_t pos=u32(s+16),len=u32(s+20),link=u32(s+24),ent=u32(s+36);
        if(link>=n||ent<16||!valid(pos,len))continue;
        size_t t=off+(size_t)link*step;
        uint32_t str=u32(t+16),sl=u32(t+20);
        if(!valid(str,sl))continue;
        for(size_t j=0;j+16<=len;j+=ent){
            uint32_t idx=u32(pos+j);
            if(idx>=sl)continue;
            const char *p=(const char*)data+str+idx;
            if(memchr(p,0,sl-idx)&&!strcmp(p,name))return u32(pos+j+4);
        }
    }return 0;
}
static size_t address(uint32_t v){
    uint32_t off=u32(28);unsigned step=u16(42),n=u16(44);
    if(step<32||!valid(off,(size_t)step*n))return SIZE_MAX;
    for(unsigned i=0;i<n;i++){
        size_t p=off+(size_t)i*step;
        uint32_t va=u32(p+8),len=u32(p+16),file=u32(p+4);
        if(u32(p)==PT_LOAD&&v>=va&&v-va<len&&valid(file,len))return (size_t)file+v-va;
    }return SIZE_MAX;
}
int main(int argc,char **argv){
    if(argc!=2)return 2;
    int fd=open(argv[1],O_RDWR);struct stat st;
    if(fd<0||fstat(fd,&st)||st.st_size<52||st.st_size>64*1024*1024){fprintf(stderr,"Q2_PATCH invalid ELF file\n");return 1;}
    size=(size_t)st.st_size;data=mmap(NULL,size,PROT_READ|PROT_WRITE,MAP_SHARED,fd,0);
    if(data==MAP_FAILED)return 1;
    if(memcmp(data,ELFMAG,SELFMAG)||data[EI_CLASS]!=ELFCLASS32||data[EI_DATA]!=ELFDATA2LSB||u16(18)!=EM_MIPS){fprintf(stderr,"Q2_PATCH unsupported ELF ABI\n");return 1;}
    uint32_t start=symbol("home_page_init"),bl=symbol("g_backlight_status");
    size_t base=start?address(start):SIZE_MAX;
    if(base==SIZE_MAX||!valid(base,128)){fprintf(stderr,"Q2_PATCH home_page_init unavailable\n");return 1;}
    int found=0;
    for(size_t p=base;p<base+128;p+=4){
        uint32_t op=u32(p);
        if(op==0x10430007||op==0x10000007){
            data[p]=7;data[p+1]=0;data[p+2]=0;data[p+3]=0x10;
            found=1;break;
        }
    }
    if(!found||msync(data,size,MS_SYNC)){fprintf(stderr,"Q2_PATCH gate not found or write failed\n");return 1;}
    fprintf(stderr,"Q2_PATCH serial gate ready, backlight=0x%08x\n",bl);
    printf("0x%08x\n",bl);
    munmap(data,size);close(fd);return 0;
}
